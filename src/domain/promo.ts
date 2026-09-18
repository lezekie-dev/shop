/**
 * Codes promo — logique de calcul PURE (chantier E, lot 2B).
 *
 * ─── POURQUOI CE MODULE EST SÉPARÉ DE `src/server/promo.ts` ──────────────
 * Le PO a fait de ce chantier un chantier de CAS LIMITES, pas d'écran
 * (risque R4 : « code promo mal validé = perte de marge silencieuse »). Or un
 * cas limite ne se teste bien que sans base de données : ici, tout prend des
 * structures de données en entrée et rend une décision en sortie. Les onze
 * scénarios de refus (expiré, pas commencé, plafond global, plafond client,
 * minimum d'achat, valeur aberrante…) se vérifient donc en quelques
 * millisecondes, sans Postgres, sans mock d'horloge.
 *
 * ─── DEUX INVARIANTS DE MONTANT (CONVENTIONS §5) ─────────────────────────
 * 1. Aucun `Float` : les montants sont des entiers (minor units) du début à la
 *    fin. Un pourcentage se calcule par `Math.floor(subtotal * value / 100)`,
 *    qui reste sur des entiers, et jamais par `subtotal * (value / 100)` — la
 *    division flottante arrondie produit des écarts de 1 centime visibles sur
 *    la facture, et ces écarts s'accumulent sur une campagne.
 * 2. `discountCents = min(calculé, subtotal)` : le total ne peut JAMAIS
 *    devenir négatif. Un code de 50 € sur un panier de 10 € offre 10 €, pas
 *    -40 € (c'est-à-dire pas un remboursement déguisé).
 *
 * ─── CE QUE CE MODULE NE FAIT PAS (périmètre fixé par le PO, section 5) ───
 * Pas de cumul de codes, pas de ciblage par produit ou catégorie, pas de
 * livraison gratuite par code. Une remise ne porte que sur le sous-total des
 * articles ; la livraison n'est jamais remisée en vague 2.
 */

import { formatMoneyEur } from "@/domain/pricing";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type PromoKind = "PERCENT" | "FIXED";

/**
 * Règle de code promo telle qu'elle est stockée — volontairement SANS le type
 * Prisma `PromoCode` : `src/domain/` ne peut pas dépendre de `@prisma/client`
 * (CONVENTIONS §2), et un objet littéral suffit à tester tous les cas.
 */
export type PromoRule = {
  code: string;
  kind: PromoKind;
  /** PERCENT : points de pourcentage (10 = 10 %). FIXED : minor units. */
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  active: boolean;
};

/** Compteurs d'usage déjà connus, lus en base par la couche serveur. */
export type PromoUsage = {
  /** Nombre total de consommations du code (tous clients). */
  totalRedemptions: number;
  /**
   * Consommations du client courant. `0` pour un visiteur identifié par son
   * seul cookie panier : le plafond par client n'est alors pas évaluable, et
   * c'est assumé (il l'est au moment de la commande, quand l'email devient
   * l'identité — cf. `src/server/promo.ts`).
   */
  customerRedemptions: number;
};

/**
 * Motifs de refus. Ils sont DISTINCTS parce que le PO l'exige : un message
 * générique « code invalide » oblige le client à deviner quoi corriger, ce
 * qui est exactement le contraire d'une remise qu'on veut voir utilisée.
 */
export type PromoRefusalReason =
  | "NOT_FOUND"
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "MIN_SUBTOTAL"
  | "MAX_REDEMPTIONS"
  | "MAX_PER_CUSTOMER"
  | "INVALID_VALUE";

export type PromoEvaluation =
  | {
      ok: true;
      /** Code normalisé (majuscules) — la forme sous laquelle il est stocké. */
      code: string;
      kind: PromoKind;
      value: number;
      /** Remise effectivement applicable, bornée au sous-total. */
      discountCents: number;
    }
  | {
      ok: false;
      reason: PromoRefusalReason;
      /** Phrase en français, actionnable, affichable telle quelle au client. */
      message: string;
      /** Renseigné quand le refus est chiffré (minimum d'achat). */
      missingCents?: number;
      /** Renseigné quand le refus est daté (pas encore commencé / expiré). */
      date?: Date;
    };

// ─────────────────────────────────────────────────────────────────────
// Normalisation et format
// ─────────────────────────────────────────────────────────────────────

export const PROMO_CODE_MIN_LENGTH = 3;
export const PROMO_CODE_MAX_LENGTH = 24;
/** Plafond d'une remise en pourcentage : au-delà, un « pourcentage » est une
 * erreur de saisie (90 au lieu de 9), et la marge part en fumée en silence. */
export const PROMO_MAX_PERCENT = 90;
const PROMO_CODE_PATTERN = /^[A-Z0-9-]+$/;

/**
 * Forme canonique d'un code : sans espaces autour, en MAJUSCULES.
 *
 * C'est ce qui fait que « bienvenue » et « BIENVENUE » sont le MÊME code : le
 * schéma stocke déjà en majuscules, donc si on comparait la saisie brute on
 * créerait des doublons invisibles (deux lignes pour un seul code, avec des
 * compteurs d'usage séparés et une marge deux fois offerte).
 */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Valide la FORME d'un code (3–24 caractères, A–Z, 0–9, tiret). */
export function isValidPromoCode(raw: string): boolean {
  const code = normalizePromoCode(raw);
  return (
    code.length >= PROMO_CODE_MIN_LENGTH &&
    code.length <= PROMO_CODE_MAX_LENGTH &&
    PROMO_CODE_PATTERN.test(code)
  );
}

/**
 * Parse une saisie humaine de montant (« 12,50 », « 12.50 », « 12 ») en minor
 * units entiers, SANS passer par un `Float`.
 *
 * POURQUOI PAS `Math.round(Number(raw) * 100)` : c'est exactement la
 * multiplication flottante que les CONVENTIONS §5 interdisent (`amount * 100`
 * où que ce soit). Sur « 12,13 » elle rend 1212,9999999999998, qui s'arrondit
 * bien ici mais pas dans une chaîne de calculs. On découpe donc la partie
 * entière et la partie décimale à la main, sur des entiers.
 *
 * Renvoie `null` si la saisie n'est pas un montant exploitable.
 */
export function parseMinorUnitsInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned.length === 0) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;

  const [unitsPart = "0", decimalsPart = ""] = cleaned.split(".");
  const units = Number.parseInt(unitsPart, 10);
  if (!Number.isSafeInteger(units)) return null;
  // On ne PAD que sur 2 décimales : une devise sans sous-unité (XAF, chantier
  // K) devra passer par son propre helper de conversion, pas par celui-ci.
  const decimals = Number.parseInt(decimalsPart.padEnd(2, "0"), 10);
  return units * 100 + decimals;
}

/** Affiche un montant du domaine sans dupliquer le formatage des prix. */
export function formatPromoAmount(cents: number): string {
  return formatMoneyEur(cents);
}

/** Date lisible d'une borne de validité (« 21 septembre 2026 »). */
export function formatPromoDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(date);
}

// ─────────────────────────────────────────────────────────────────────
// Calcul de la remise
// ─────────────────────────────────────────────────────────────────────

/**
 * Remise en minor units pour un sous-total donné.
 *
 * Trois protections, dans cet ordre :
 *   1. une règle non exploitable (`value <= 0`) ne remise RIEN — une valeur
 *      aberrante ne doit jamais devenir un cadeau ;
 *   2. PERCENT arrondit vers le BAS (`Math.floor`) : on ne donne jamais plus
 *      que le pourcentage annoncé, même d'un centime ;
 *   3. la remise est bornée au sous-total : le total ne peut pas être négatif.
 *
 * Renvoie toujours un entier >= 0.
 */
export function computeDiscountCents(
  rule: Pick<PromoRule, "kind" | "value">,
  subtotalCents: number,
): number {
  const subtotal = Number.isFinite(subtotalCents) ? Math.max(0, Math.trunc(subtotalCents)) : 0;
  const value = Number.isFinite(rule.value) ? Math.trunc(rule.value) : 0;
  if (value <= 0 || subtotal === 0) return 0;

  const raw = rule.kind === "PERCENT" ? Math.floor((subtotal * value) / 100) : value;
  return Math.min(Math.max(0, raw), subtotal);
}

/**
 * Total d'une commande une fois la remise appliquée.
 *
 * La livraison n'est JAMAIS remisée en vague 2 (décision du PO, section 5 :
 * « livraison gratuite par code » est hors périmètre) : le plafonnement porte
 * donc déjà uniquement sur le sous-total, et on additionne la livraison nue.
 */
export function totalWithDiscountCents(params: {
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
}): number {
  const subtotal = Math.max(0, Math.trunc(params.subtotalCents));
  const shipping = Math.max(0, Math.trunc(params.shippingCents));
  const discount = Math.min(Math.max(0, Math.trunc(params.discountCents)), subtotal);
  return subtotal - discount + shipping;
}

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

/**
 * Décide si un code s'applique à un panier, et pour quel montant.
 *
 * L'ordre des contrôles n'est pas cosmétique : il détermine quel message le
 * client reçoit quand plusieurs raisons se cumulent. On va du plus utile au
 * plus générique — « il manque 12,50 € » est actionnable, « code désactivé »
 * ne l'est pas.
 *
 * `usage` est passé par l'appelant (lu en base) : la fonction reste pure, donc
 * testable, et c'est la même décision qui est prise à l'affichage du panier et
 * dans la transaction de commande.
 */
export function evaluatePromo(input: {
  rule: PromoRule | null;
  subtotalCents: number;
  now: Date;
  usage: PromoUsage;
}): PromoEvaluation {
  const { rule, subtotalCents, now, usage } = input;

  if (!rule) {
    return {
      ok: false,
      reason: "NOT_FOUND",
      message:
        "Ce code promo n'existe pas. Vérifiez l'orthographe : il n'y a ni espace ni accent dans un code.",
    };
  }

  // Une règle mal configurée se refuse AVANT tout contrôle de date : peu
  // importe la campagne, elle n'accorderait pas la remise annoncée.
  if (
    !Number.isInteger(rule.value) ||
    rule.value <= 0 ||
    (rule.kind === "PERCENT" && rule.value > PROMO_MAX_PERCENT)
  ) {
    return {
      ok: false,
      reason: "INVALID_VALUE",
      message:
        "Ce code promo est mal configuré et ne peut pas être appliqué. Signalez-le à la boutique : elle doit corriger la remise.",
    };
  }

  if (!rule.active) {
    return {
      ok: false,
      reason: "INACTIVE",
      message:
        "Ce code promo a été désactivé par la boutique. Il ne peut plus être utilisé.",
    };
  }

  if (rule.startsAt && now.getTime() < rule.startsAt.getTime()) {
    return {
      ok: false,
      reason: "NOT_STARTED",
      message: `Ce code promo n'est pas encore valable : il sera actif à partir du ${formatPromoDate(rule.startsAt)}.`,
      date: rule.startsAt,
    };
  }

  if (rule.endsAt && now.getTime() > rule.endsAt.getTime()) {
    return {
      ok: false,
      reason: "EXPIRED",
      message: `Ce code promo a expiré le ${formatPromoDate(rule.endsAt)}.`,
      date: rule.endsAt,
    };
  }

  const missingCents = rule.minSubtotalCents - subtotalCents;
  if (missingCents > 0) {
    // Le MONTANT MANQUANT est la seule information qui permet au client de
    // compléter son panier pour atteindre le minimum : on le chiffre.
    return {
      ok: false,
      reason: "MIN_SUBTOTAL",
      message: `Ce code promo demande un minimum de ${formatPromoAmount(rule.minSubtotalCents)} d'achats. Il manque ${formatPromoAmount(missingCents)} sur votre panier pour en profiter.`,
      missingCents,
    };
  }

  if (rule.maxRedemptions !== null && usage.totalRedemptions >= rule.maxRedemptions) {
    return {
      ok: false,
      reason: "MAX_REDEMPTIONS",
      message:
        "Ce code promo a atteint son nombre maximum d'utilisations. Il n'est plus disponible.",
    };
  }

  if (rule.maxPerCustomer !== null && usage.customerRedemptions >= rule.maxPerCustomer) {
    return {
      ok: false,
      reason: "MAX_PER_CUSTOMER",
      message: "Vous avez déjà utilisé ce code promo. Chaque client peut en profiter une seule fois.",
    };
  }

  const discountCents = computeDiscountCents(rule, subtotalCents);
  return {
    ok: true,
    code: rule.code,
    kind: rule.kind,
    value: rule.value,
    discountCents,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Statut affiché dans le back-office
// ─────────────────────────────────────────────────────────────────────

export type PromoStatus = "SCHEDULED" | "ACTIVE" | "EXPIRED" | "EXHAUSTED" | "DISABLED";

/**
 * Statut déduit d'un code, tel que Fatou doit le lire dans la liste (à venir /
 * actif / expiré / épuisé / désactivé).
 *
 * « Désactivé » l'emporte sur tout le reste : c'est la seule cause sur laquelle
 * la marchande peut agir en un clic, et un code désactivé reste désactivé,
 * quelles que soient ses dates.
 */
export function describePromoStatus(
  rule: Pick<PromoRule, "active" | "startsAt" | "endsAt" | "maxRedemptions">,
  usage: PromoUsage,
  now: Date,
): PromoStatus {
  if (!rule.active) return "DISABLED";
  if (rule.maxRedemptions !== null && usage.totalRedemptions >= rule.maxRedemptions) {
    return "EXHAUSTED";
  }
  if (rule.startsAt && now.getTime() < rule.startsAt.getTime()) return "SCHEDULED";
  if (rule.endsAt && now.getTime() > rule.endsAt.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/** Libellé humain d'un statut — un seul endroit, pour l'admin et les mails. */
export function promoStatusLabel(status: PromoStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Actif";
    case "SCHEDULED":
      return "À venir";
    case "EXPIRED":
      return "Expiré";
    case "EXHAUSTED":
      return "Épuisé";
    case "DISABLED":
      return "Désactivé";
  }
}

/**
 * Résumé de la règle en une phrase, pour la liste d'administration : Fatou doit
 * comprendre « −10 % » ou « −5,00 € » sans ouvrir le formulaire.
 */
export function describePromoRule(rule: Pick<PromoRule, "kind" | "value">): string {
  return rule.kind === "PERCENT"
    ? `−${rule.value} %`
    : `−${formatPromoAmount(rule.value)}`;
}
