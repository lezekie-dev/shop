/**
 * Codes promo — accès base et application (chantier E, lot 2B).
 *
 * ─── POURQUOI LA DÉCISION VIT DANS `src/domain/promo.ts` ─────────────────
 * Ce module ne fait que deux choses : LIRE l'état dont la décision a besoin
 * (la règle, les compteurs d'usage, l'heure) et ÉCRIRE la conséquence
 * (le code du panier, la `PromoRedemption` de la commande). Aucune règle de
 * calcul n'est réécrite ici : sans ça, le panier et le checkout finiraient par
 * calculer deux remises différentes — c'est le scénario exact du risque R4.
 *
 * ─── LE CLIENT N'ENVOIE JAMAIS UN MONTANT ───────────────────────────────
 * Le seul contrat exposé au client est « un code » (une chaîne), stocké dans
 * `Cart.promoCode`. La remise est TOUJOURS recalculée à partir du sous-total
 * lu en base, à chaque affichage et à la commande. Un `discountCents` envoyé
 * par le navigateur n'a aucun chemin d'écriture : il est ignoré (le schéma de
 * la route checkout ne le connaît pas).
 */

// `Prisma` est importé comme VALEUR : on l'utilise aussi comme namespace
// d'erreurs (`Prisma.PrismaClientKnownRequestError`), pas seulement comme type.
import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  computeDiscountCents,
  describePromoStatus,
  evaluatePromo,
  isValidPromoCode,
  normalizePromoCode,
  PROMO_MAX_PERCENT,
  type PromoEvaluation,
  type PromoKind,
  type PromoRule,
  type PromoStatus,
  type PromoUsage,
} from "@/domain/promo";
import { writeAuditLog } from "@/server/audit-log";

/** Client Prisma complet ou client de transaction — comme `AuditDb`. */
export type PromoDb = PrismaClient | Prisma.TransactionClient;

export class PromoError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CART_NOT_FOUND"
      | "CART_NOT_ACTIVE"
      | "INVALID_CODE"
      | "INVALID_VALUE"
      | "INVALID_WINDOW"
      | "CODE_TAKEN"
      | "NOT_FOUND"
      | "REDEMPTION_ALREADY_EXISTS",
  ) {
    super(message);
    this.name = "PromoError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lecture
// ─────────────────────────────────────────────────────────────────────

type PromoRow = {
  id: string;
  code: string;
  kind: "PERCENT" | "FIXED";
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  active: boolean;
};

export type PromoRuleRow = PromoRule & { id: string };

const PROMO_SELECT = {
  id: true,
  code: true,
  kind: true,
  value: true,
  minSubtotalCents: true,
  startsAt: true,
  endsAt: true,
  maxRedemptions: true,
  maxPerCustomer: true,
  active: true,
} as const;

/** Traduit une ligne Prisma en structure de domaine (aucun type Prisma ne
 * franchit la frontière du domaine). */
function toRuleRow(row: PromoRow): PromoRuleRow {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    minSubtotalCents: row.minSubtotalCents,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxRedemptions: row.maxRedemptions,
    maxPerCustomer: row.maxPerCustomer,
    active: row.active,
  };
}

/**
 * Cherche une règle par code, en MAJUSCULES.
 *
 * La normalisation est faite ICI et pas seulement à l'écriture : c'est ce qui
 * rend « bienvenue » et « BIENVENUE » interchangeables pour le client, sans
 * stocker deux lignes pour un même code.
 */
export async function findPromoByCode(
  db: PromoDb,
  rawCode: string,
): Promise<PromoRuleRow | null> {
  const code = normalizePromoCode(rawCode);
  if (code.length === 0) return null;
  const row = await db.promoCode.findUnique({ where: { code }, select: PROMO_SELECT });
  return row ? toRuleRow(row) : null;
}

/**
 * Compteurs d'usage d'un code.
 *
 * `customerId` nul (visiteur sans compte, identifié par son seul cookie
 * panier) : le plafond PAR CLIENT n'est pas évaluable à l'affichage. Il l'est
 * à la commande, où l'email devient l'identité du client — c'est le seul
 * moment où l'information existe, et c'est le moment qui compte.
 */
export async function readPromoUsage(
  db: PromoDb,
  promoCodeId: string,
  customerId: string | null,
): Promise<PromoUsage> {
  const [totalRedemptions, customerRedemptions] = await Promise.all([
    db.promoRedemption.count({ where: { promoCodeId } }),
    customerId
      ? db.promoRedemption.count({ where: { promoCodeId, customerId } })
      : Promise.resolve(0),
  ]);
  return { totalRedemptions, customerRedemptions };
}

/**
 * Décision complète pour un sous-total donné. C'est LE point d'entrée commun
 * du panier et du checkout : une seule décision, deux affichages.
 */
export async function evaluatePromoCode(params: {
  rawCode: string;
  subtotalCents: number;
  customerId: string | null;
  now?: Date;
  db?: PromoDb;
}): Promise<{ rule: PromoRuleRow | null; evaluation: PromoEvaluation }> {
  const db = params.db ?? prisma;
  const now = params.now ?? new Date();
  const rule = await findPromoByCode(db, params.rawCode);

  if (!rule) {
    return {
      rule: null,
      evaluation: evaluatePromo({
        rule: null,
        subtotalCents: params.subtotalCents,
        now,
        usage: { totalRedemptions: 0, customerRedemptions: 0 },
      }),
    };
  }

  const usage = await readPromoUsage(db, rule.id, params.customerId);
  return {
    rule,
    evaluation: evaluatePromo({ rule, subtotalCents: params.subtotalCents, now, usage }),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Application au panier
// ─────────────────────────────────────────────────────────────────────

export type PromoApplyResult = {
  /** `true` : le code est stocké sur le panier et la remise est affichable. */
  applied: boolean;
  /** Code normalisé conservé sur le panier, `null` si aucun code ne s'applique. */
  promoCode: string | null;
  discountCents: number;
  /** Renseigné seulement en cas de refus : motif stable + phrase actionnable. */
  reason?: string;
  message?: string;
};

/**
 * Applique un code au panier (saisie client).
 *
 * DEUX COMPORTEMENTS VOLONTAIRES :
 *   1. un code refusé est RETIRÉ du panier (remise à zéro), même s'il y en
 *      avait un avant : « nouveau code saisi → l'ancien est remplacé » (AC E2).
 *      Conserver un ancien code en base après un refus ferait apparaître une
 *      remise que le client ne voit nulle part.
 *   2. la remise stockée (`Cart.discountCents`) n'est qu'un CONFORORT
 *      d'affichage : elle est recalculée à chaque rendu à partir de
 *      `Cart.promoCode`, donc jamais « figée en cache » (AC E2).
 */
export async function applyPromoCodeToCart(params: {
  cartId: string;
  rawCode: string;
  now?: Date;
}): Promise<PromoApplyResult> {
  const now = params.now ?? new Date();

  const cart = await prisma.cart.findUnique({
    where: { id: params.cartId },
    include: { items: true },
  });
  if (!cart) throw new PromoError(`Cart introuvable: ${params.cartId}`, "CART_NOT_FOUND");
  if (cart.status !== "ACTIVE") {
    throw new PromoError(`Cart ${params.cartId} n'est pas ACTIVE`, "CART_NOT_ACTIVE");
  }

  const subtotalCents = cart.items.reduce((acc, i) => acc + i.quantity * i.unitPriceCents, 0);
  const { evaluation } = await evaluatePromoCode({
    rawCode: params.rawCode,
    subtotalCents,
    customerId: cart.customerId,
    now,
  });

  if (!evaluation.ok) {
    await prisma.cart.update({
      where: { id: cart.id },
      data: { promoCode: null, discountCents: 0 },
    });
    return {
      applied: false,
      promoCode: null,
      discountCents: 0,
      reason: evaluation.reason,
      message: evaluation.message,
    };
  }

  await prisma.cart.update({
    where: { id: cart.id },
    data: { promoCode: evaluation.code, discountCents: evaluation.discountCents },
  });
  return {
    applied: true,
    promoCode: evaluation.code,
    discountCents: evaluation.discountCents,
  };
}

/** Retire le code du panier : le total revient à l'identique (AC E2). */
export async function clearPromoCodeFromCart(
  cartId: string,
): Promise<{ promoCode: null; discountCents: 0 }> {
  await prisma.cart.update({
    where: { id: cartId },
    data: { promoCode: null, discountCents: 0 },
  });
  return { promoCode: null, discountCents: 0 };
}

/**
 * Recalcule la remise d'un panier POUR L'AFFICHAGE, sans rien écrire.
 *
 * Rend `null` quand aucun code n'est saisi — l'appelant distingue alors
 * « pas de code » de « code refusé », et n'affiche pas un message d'erreur
 * pour un panier qui n'a jamais eu de code.
 */
export async function previewCartPromo(params: {
  promoCode: string | null;
  subtotalCents: number;
  customerId: string | null;
  now?: Date;
}): Promise<{ evaluation: PromoEvaluation; discountCents: number } | null> {
  if (!params.promoCode) return null;
  const { evaluation } = await evaluatePromoCode({
    rawCode: params.promoCode,
    subtotalCents: params.subtotalCents,
    customerId: params.customerId,
    ...(params.now ? { now: params.now } : {}),
  });
  return {
    evaluation,
    discountCents: evaluation.ok ? evaluation.discountCents : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Consommation à la commande
// ─────────────────────────────────────────────────────────────────────

/**
 * Écrit la consommation d'un usage — la partie ÉCRITURE, séparée de la
 * décision.
 *
 * POURQUOI SÉPARÉE : la `PromoRedemption` porte une clé étrangère vers
 * `Order`, donc la ligne ne peut exister qu'APRÈS la commande. Or le montant
 * de la remise doit être connu AVANT d'insérer la commande (il fait partie de
 * son total). La décision est donc prise et le montant figé d'abord, la
 * consommation est enregistrée ensuite — les deux dans la MÊME transaction, ce
 * qui est la seule chose qui garantit qu'un plafond ne peut pas être dépassé.
 */
export async function recordPromoRedemption(
  tx: Prisma.TransactionClient,
  params: {
    promoCodeId: string;
    orderId: string;
    customerId: string | null;
    amountCents: number;
  },
): Promise<void> {
  // `amountCents` porte le coût réel de la remise : c'est la donnée du KPI K6
  // (« coût des remises / CA du mois ») et la preuve en cas de litige.
  await tx.promoRedemption.create({
    data: {
      promoCodeId: params.promoCodeId,
      orderId: params.orderId,
      customerId: params.customerId,
      amountCents: params.amountCents,
    },
  });
}

/**
 * Décide PUIS consomme, en une seule opération — la composition complète,
 * utile quand l'appelant n'a pas besoin de connaître la remise à l'avance.
 *
 * POURQUOI ÇA NE JETTE PAS : un code devenu invalide entre le panier et le
 * paiement ne doit pas faire échouer la commande (AC E2 : « sans erreur pour
 * le client »). Le motif remonte à l'appelant pour qu'il explique le total
 * que le client paie, et le code n'est pas consommé.
 */
export async function redeemPromoInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    rawCode: string;
    subtotalCents: number;
    orderId: string;
    customerId: string | null;
    now: Date;
  },
): Promise<PromoEvaluation> {
  const { evaluation, rule } = await evaluatePromoCode({
    rawCode: params.rawCode,
    subtotalCents: params.subtotalCents,
    customerId: params.customerId,
    now: params.now,
    db: tx,
  });

  if (!evaluation.ok || !rule) return evaluation;

  await recordPromoRedemption(tx, {
    promoCodeId: rule.id,
    orderId: params.orderId,
    customerId: params.customerId,
    amountCents: evaluation.discountCents,
  });

  return evaluation;
}

/**
 * Libère l'usage d'un code quand la vente n'a pas eu lieu (décision D3).
 *
 * POURQUOI ON SUPPRIME LA LIGNE AU LIEU DE LA MARQUER ANNULÉE : les plafonds
 * (`maxRedemptions`, `maxPerCustomer`) sont des COMPTES sur cette table. Une
 * ligne conservée avec un drapeau « annulée » serait comptée quand même, et
 * Fatou verrait « code déjà utilisé » pour une vente qu'elle n'a jamais
 * encaissée. La trace de l'opération, elle, reste dans le journal d'audit —
 * c'est bien le journal qui doit survivre, pas le compteur.
 */
export async function releasePromoRedemption(
  db: PromoDb,
  params: { orderId: string; actorId?: string | undefined; reason: string },
): Promise<{ released: boolean; code: string | null; amountCents: number | null }> {
  const redemption = await db.promoRedemption.findUnique({
    where: { orderId: params.orderId },
    include: { promoCode: { select: { code: true } } },
  });
  if (!redemption) return { released: false, code: null, amountCents: null };

  await db.promoRedemption.delete({ where: { id: redemption.id } });

  // Un acteur sans identifiant (tâche système) ne peut pas alimenter une piste
  // d'audit : on n'écrit pas une ligne anonyme, qui serait inexploitable.
  if (params.actorId) {
    await writeAuditLog(db, {
      userId: params.actorId,
      action: "promo.release",
      entity: "PromoRedemption",
      entityId: redemption.id,
      diff: {
        orderId: params.orderId,
        code: redemption.promoCode.code,
        amountCents: redemption.amountCents,
        reason: params.reason,
      },
    });
  }

  return {
    released: true,
    code: redemption.promoCode.code,
    amountCents: redemption.amountCents,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Administration
// ─────────────────────────────────────────────────────────────────────

export type AdminPromoRow = {
  id: string;
  code: string;
  kind: PromoKind;
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  active: boolean;
  createdAt: Date;
  status: PromoStatus;
  /** Nombre d'utilisations consommées. */
  redemptions: number;
  /** Ce que le code a COÛTÉ en remises cumulées — pas seulement son usage. */
  discountTotalCents: number;
};

/**
 * Liste des codes pour le back-office, avec usage et coût cumulé.
 *
 * Le coût (`discountTotalCents`) est la donnée qui manque partout ailleurs :
 * Fatou doit voir ce que le code lui COÛTE, sinon un code « utilisé 40 fois »
 * peut cacher 400 € de marge offerte.
 */
export async function listPromoCodes(now: Date = new Date()): Promise<AdminPromoRow[]> {
  const promos = await prisma.promoCode.findMany({
    select: { ...PROMO_SELECT, createdAt: true },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });

  const grouped = await prisma.promoRedemption.groupBy({
    by: ["promoCodeId"],
    _count: { _all: true },
    _sum: { amountCents: true },
  });
  const stats = new Map(
    grouped.map((g) => [
      g.promoCodeId,
      { count: g._count._all, amountCents: g._sum.amountCents ?? 0 },
    ]),
  );

  return promos.map((promo) => {
    const stat = stats.get(promo.id) ?? { count: 0, amountCents: 0 };
    const rule = toRuleRow(promo);
    return {
      ...rule,
      createdAt: promo.createdAt,
      status: describePromoStatus(rule, { totalRedemptions: stat.count, customerRedemptions: 0 }, now),
      redemptions: stat.count,
      discountTotalCents: stat.amountCents,
    };
  });
}

export type PromoWriteInput = {
  code: string;
  kind: PromoKind;
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  active: boolean;
};

export type PromoWriteFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
};

export type PromoWriteResult = { ok: true; promo: AdminPromoRow } | PromoWriteFailure;

/**
 * Contrôles métier, au-delà de la forme (zod vérifie déjà les types).
 *
 * Ces trois règles ne sont pas des caprices de validation :
 *   - un code mal formé est introuvable pour un client (il tape ce qu'il voit
 *     sur l'affiche) ;
 *   - `PERCENT > 90` est presque toujours une virgule oubliée : c'est la
 *     remise qui vide la marge sans se voir (risque R4) ;
 *   - une fenêtre inversée produit un code jamais valable, que la marchande
 *     croira « actif » parce qu'il est activé.
 */
function assertPromoInput(input: {
  code: string;
  kind: PromoKind;
  value: number;
  minSubtotalCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
}): void {
  if (!isValidPromoCode(input.code)) {
    throw new PromoError(
      "Code invalide : 3 à 24 caractères, lettres A–Z, chiffres et tirets uniquement (sans espace ni accent).",
      "INVALID_CODE",
    );
  }
  if (!Number.isInteger(input.value) || input.value <= 0) {
    throw new PromoError("La valeur de la remise doit être un entier strictement positif.", "INVALID_VALUE");
  }
  if (input.kind === "PERCENT" && input.value > PROMO_MAX_PERCENT) {
    throw new PromoError(
      `Une remise en pourcentage ne peut pas dépasser ${PROMO_MAX_PERCENT} % : au-delà, c'est presque toujours une erreur de saisie.`,
      "INVALID_VALUE",
    );
  }
  if (input.minSubtotalCents < 0 || !Number.isInteger(input.minSubtotalCents)) {
    throw new PromoError("Le minimum d'achat doit être un entier positif (0 = aucun minimum).", "INVALID_VALUE");
  }
  if (input.startsAt && input.endsAt && input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new PromoError(
      "La date de fin doit être postérieure à la date de début, sinon le code ne serait jamais valable.",
      "INVALID_WINDOW",
    );
  }
}

export async function createPromoCode(params: {
  actorId: string;
  input: PromoWriteInput;
  now?: Date;
}): Promise<PromoWriteResult> {
  const input: PromoWriteInput = {
    ...params.input,
    // Le code est stocké en MAJUSCULES : c'est ce qui garantit qu'une seule
    // ligne existe pour « BIENVENUE », quelle que soit la frappe de Fatou.
    code: normalizePromoCode(params.input.code),
  };

  try {
    assertPromoInput(input);
  } catch (err) {
    if (err instanceof PromoError) {
      return { ok: false, code: err.code, message: err.message, status: 400 };
    }
    throw err;
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.create({
        data: {
          code: input.code,
          kind: input.kind,
          value: input.value,
          minSubtotalCents: input.minSubtotalCents,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          maxRedemptions: input.maxRedemptions,
          maxPerCustomer: input.maxPerCustomer,
          // Un code actif dès sa création est un code qu'on oublie de vérifier :
          // l'activation est un geste explicite (AC E1). La valeur par défaut de
          // la colonne est `true`, donc c'est bien ici qu'on tranche.
          active: input.active,
        },
        select: { ...PROMO_SELECT, createdAt: true },
      });

      await writeAuditLog(tx, {
        userId: params.actorId,
        action: "promo.create",
        entity: "PromoCode",
        entityId: promo.id,
        diff: {
          after: {
            code: promo.code,
            kind: promo.kind,
            value: promo.value,
            minSubtotalCents: promo.minSubtotalCents,
            startsAt: promo.startsAt,
            endsAt: promo.endsAt,
            maxRedemptions: promo.maxRedemptions,
            maxPerCustomer: promo.maxPerCustomer,
            active: promo.active,
          },
        },
      });

      return promo;
    });

    return { ok: true, promo: toAdminRow(created, params.now ?? new Date()) };
  } catch (err) {
    return mapPromoWriteError(err);
  }
}

export type PromoUpdatePatch = Partial<PromoWriteInput>;

export async function updatePromoCode(params: {
  actorId: string;
  promoId: string;
  patch: PromoUpdatePatch;
  now?: Date;
}): Promise<PromoWriteResult> {
  const existing = await prisma.promoCode.findUnique({
    where: { id: params.promoId },
    select: { ...PROMO_SELECT, createdAt: true },
  });
  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Ce code promo n'existe pas.", status: 404 };
  }

  const merged = {
    code: params.patch.code !== undefined ? normalizePromoCode(params.patch.code) : existing.code,
    kind: params.patch.kind ?? existing.kind,
    value: params.patch.value ?? existing.value,
    minSubtotalCents: params.patch.minSubtotalCents ?? existing.minSubtotalCents,
    startsAt: params.patch.startsAt !== undefined ? params.patch.startsAt : existing.startsAt,
    endsAt: params.patch.endsAt !== undefined ? params.patch.endsAt : existing.endsAt,
  };

  try {
    assertPromoInput(merged);
  } catch (err) {
    if (err instanceof PromoError) {
      return { ok: false, code: err.code, message: err.message, status: 400 };
    }
    throw err;
  }

  const changed: string[] = [];
  if (merged.code !== existing.code) changed.push("code");
  if (merged.kind !== existing.kind) changed.push("kind");
  if (merged.value !== existing.value) changed.push("value");
  if (merged.minSubtotalCents !== existing.minSubtotalCents) changed.push("minSubtotalCents");
  if (params.patch.active !== undefined && params.patch.active !== existing.active) changed.push("active");
  if (params.patch.maxRedemptions !== undefined && params.patch.maxRedemptions !== existing.maxRedemptions) {
    changed.push("maxRedemptions");
  }
  if (params.patch.maxPerCustomer !== undefined && params.patch.maxPerCustomer !== existing.maxPerCustomer) {
    changed.push("maxPerCustomer");
  }
  if (params.patch.startsAt !== undefined) changed.push("startsAt");
  if (params.patch.endsAt !== undefined) changed.push("endsAt");

  // Une sauvegarde sans modification ne doit pas polluer la piste d'audit
  // d'une ligne « promo.update » vide (même règle que `updateAdminUser`).
  if (changed.length === 0) {
    return { ok: true, promo: toAdminRow({ ...existing }, params.now ?? new Date()) };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const promo = await tx.promoCode.update({
        where: { id: existing.id },
        data: {
          code: merged.code,
          kind: merged.kind,
          value: merged.value,
          minSubtotalCents: merged.minSubtotalCents,
          startsAt: merged.startsAt,
          endsAt: merged.endsAt,
          ...(params.patch.maxRedemptions !== undefined
            ? { maxRedemptions: params.patch.maxRedemptions }
            : {}),
          ...(params.patch.maxPerCustomer !== undefined
            ? { maxPerCustomer: params.patch.maxPerCustomer }
            : {}),
          ...(params.patch.active !== undefined ? { active: params.patch.active } : {}),
        },
        select: { ...PROMO_SELECT, createdAt: true },
      });

      await writeAuditLog(tx, {
        userId: params.actorId,
        action: "promo.update",
        entity: "PromoCode",
        entityId: promo.id,
        diff: {
          before: {
            code: existing.code,
            kind: existing.kind,
            value: existing.value,
            active: existing.active,
          },
          after: {
            code: promo.code,
            kind: promo.kind,
            value: promo.value,
            active: promo.active,
          },
          changed,
        },
      });

      return promo;
    });

    return { ok: true, promo: toAdminRow(updated, params.now ?? new Date()) };
  } catch (err) {
    return mapPromoWriteError(err);
  }
}

function toAdminRow(
  row: PromoRow & { createdAt: Date },
  now: Date,
  stats: { redemptions: number; discountTotalCents: number } = {
    redemptions: 0,
    discountTotalCents: 0,
  },
): AdminPromoRow {
  const rule = toRuleRow(row);
  return {
    ...rule,
    createdAt: row.createdAt,
    status: describePromoStatus(
      rule,
      { totalRedemptions: stats.redemptions, customerRedemptions: 0 },
      now,
    ),
    redemptions: stats.redemptions,
    discountTotalCents: stats.discountTotalCents,
  };
}

function mapPromoWriteError(err: unknown): PromoWriteFailure {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return {
      ok: false,
      code: "CODE_TAKEN",
      message: "Un code promo identique existe déjà : les majuscules et les minuscules ne le distinguent pas.",
      status: 409,
    };
  }
  throw err;
}

/** Calcul d'affichage partagé — évite de réimporter le domaine dans l'UI. */
export function discountForSubtotal(
  rule: Pick<PromoRule, "kind" | "value">,
  subtotalCents: number,
): number {
  return computeDiscountCents(rule, subtotalCents);
}
