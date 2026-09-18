import type { OrderStatus, ReviewStatus } from "@prisma/client";

/**
 * Avis clients — logique PURE (validation, éligibilité, agrégats).
 *
 * TypeScript pur, aucune dépendance runtime (cf. CONVENTIONS §2) : ce module ne
 * lit ni la base, ni l'heure système, ni les variables d'environnement. Tout ce
 * qui dépend du temps (`now`) est reçu en paramètre. Conséquence voulue : les
 * règles d'éligibilité et de validation se testent sans base ni mock, et
 * `src/server/reviews.ts` ne fait plus que les nourrir de lignes lues en base.
 *
 * POURQUOI LES RÈGLES VIVENT ICI ET PAS DANS LA ROUTE API
 * Le formulaire public d'avis est la seule surface d'ÉCRITURE ouverte à un
 * client non interne (risque R5 du PO-BRIEF V2). Une règle posée côté
 * formulaire n'est pas une règle : elle se contourne en appelant l'API
 * directement. Les limites de longueur, le refus de HTML et le refus d'URL sont
 * donc ici, appelés par la route — jamais seulement par l'UI.
 */

// ─────────────────────────────────────────────────────────────────────
// Bornes de saisie (F2 du PO-BRIEF V2 §3.4)
// ─────────────────────────────────────────────────────────────────────

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/** Texte minimal : en dessous, l'avis n'informe personne (« ok »). */
export const MIN_BODY_LENGTH = 10;
/** Texte maximal : au-delà, c'est du spam ou un copier-coller, et ça coûte cher en modération. */
export const MAX_BODY_LENGTH = 1_000;
export const MAX_TITLE_LENGTH = 80;
export const MAX_AUTHOR_NAME_LENGTH = 60;
/** Nom affiché minimal : une initiale seule ne distingue pas deux avis. */
export const MIN_AUTHOR_NAME_LENGTH = 2;

/**
 * Nombre de jours au-delà duquel un avis en attente est considéré comme en
 * retard de modération. C'est le KPI K8 du PO-BRIEF V2 : « 0 avis PENDING de
 * plus de 7 jours ». Le seuil est exporté ici pour que la page admin, le
 * compteur et les tests parlent du MÊME chiffre — un seuil recopié à trois
 * endroits finit par diverger.
 */
export const MODERATION_OVERDUE_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

export type ReviewField = "rating" | "title" | "body" | "authorName";

export type ReviewFieldError = {
  field: ReviewField;
  message: string;
};

export type ValidatedReviewInput = {
  rating: number;
  /** `null` quand le titre est vide : on ne stocke pas une chaîne blanche. */
  title: string | null;
  body: string;
  authorName: string;
};

export type ReviewValidationResult =
  | { ok: true; value: ValidatedReviewInput }
  | { ok: false; errors: ReviewFieldError[] };

/** Saisie brute d'un avis, telle qu'elle arrive du formulaire (ou de l'API). */
export type ReviewInput = {
  rating: unknown;
  title?: unknown;
  body?: unknown;
  authorName?: unknown;
};

/**
 * Détecte une tentative de balisage HTML.
 *
 * On refuse à la SOUMISSION plutôt que d'espérer échapper à l'affichage : un
 * `<` dans un avis n'a aucune raison métier d'exister (F2 : « aucun HTML n'est
 * rendu depuis le corps d'avis »), et le refus est visible par l'auteur, qui
 * peut reformuler — alors qu'un contenu silencieusement mutilé ne se comprend
 * pas. L'affichage reste malgré tout en texte brut (voir `toDisplayText`),
 * défense en profondeur : une ligne insérée directement en base (import,
 * commande SQL, bug futur) ne doit pas pouvoir produire d'élément.
 */
export function containsHtml(value: string): boolean {
  return /[<>]/.test(value);
}

/**
 * Détecte un lien (http, https, www) — ou une écriture déguisée du type
 * `https[:]//` / `hxxp://` que les spammeurs utilisent pour passer un filtre
 * naïf.
 */
export function containsUrl(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[\s\u00a0]/g, "");
  return /(https?|hxxp|ftp)(:|%3a|\/\/)|www\./.test(normalized) || /https?:\/\//.test(value.toLowerCase());
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Valide une saisie d'avis. Retourne TOUTES les erreurs d'un coup : un
 * formulaire qui ne signale qu'un problème à la fois oblige à trois
 * allers-retours, ce qui est exactement ce qu'on veut éviter en 3G.
 */
export function validateReviewInput(input: ReviewInput): ReviewValidationResult {
  const errors: ReviewFieldError[] = [];

  // ── Note : entière, bornée. Un `3.5` étoiles n'existe pas dans l'UI, mais
  // une API appelée à la main peut l'envoyer : on refuse plutôt que d'arrondir
  // en silence (une note affichée doit être la note déposée).
  const ratingRaw = input.rating;
  const rating = typeof ratingRaw === "number" ? ratingRaw : Number.NaN;
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    errors.push({
      field: "rating",
      message: `La note est obligatoire et doit être un entier de ${MIN_RATING} à ${MAX_RATING}.`,
    });
  }

  const authorName = asTrimmedString(input.authorName);
  if (authorName.length < MIN_AUTHOR_NAME_LENGTH || authorName.length > MAX_AUTHOR_NAME_LENGTH) {
    errors.push({
      field: "authorName",
      message: `Le nom affiché doit faire entre ${MIN_AUTHOR_NAME_LENGTH} et ${MAX_AUTHOR_NAME_LENGTH} caractères.`,
    });
  } else if (containsHtml(authorName) || containsUrl(authorName)) {
    errors.push({ field: "authorName", message: "Le nom affiché ne peut pas contenir de HTML ni de lien." });
  }

  const title = asTrimmedString(input.title);
  if (title.length > MAX_TITLE_LENGTH) {
    errors.push({ field: "title", message: `Le titre ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères.` });
  } else if (title.length > 0 && (containsHtml(title) || containsUrl(title))) {
    errors.push({ field: "title", message: "Le titre ne peut pas contenir de HTML ni de lien." });
  }

  const body = asTrimmedString(input.body);
  if (body.length < MIN_BODY_LENGTH) {
    errors.push({
      field: "body",
      message: `Le texte de l'avis doit contenir au moins ${MIN_BODY_LENGTH} caractères.`,
    });
  } else if (body.length > MAX_BODY_LENGTH) {
    errors.push({
      field: "body",
      message: `Le texte de l'avis ne peut pas dépasser ${MAX_BODY_LENGTH} caractères.`,
    });
  } else if (containsHtml(body)) {
    errors.push({ field: "body", message: "Le texte de l'avis ne peut pas contenir de balise HTML." });
  } else if (containsUrl(body)) {
    // F2 : « une URL dans un avis est refusée à la soumission ». Refus
    // explicite plutôt que neutralisation silencieuse : les deux sont
    // conformes au PO, mais un refus se comprend.
    errors.push({ field: "body", message: "Le texte de l'avis ne peut pas contenir de lien." });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      rating,
      title: title.length > 0 ? title : null,
      body,
      authorName,
    },
  };
}

/**
 * Texte d'affichage d'un avis : neutralise le balisage et casse les liens.
 *
 * Utilisé par l'UI publique. Ce n'est PAS la seule protection — React échappe
 * le texte et aucun composant n'utilise `dangerouslySetInnerHTML` — mais il
 * coûte trois lignes et rend le résultat vrai même si une ligne douteuse
 * arrive en base par un autre chemin (import, correction manuelle).
 */
export function toDisplayText(value: string): string {
  return value
    .replace(/[<>]/g, "")
    .replace(/(https?|hxxp):\/\//gi, "$1 ://")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────
// Note moyenne et répartition (F1)
// ─────────────────────────────────────────────────────────────────────

export type RatedReview = {
  rating: number;
  status: ReviewStatus;
};

export type RatingSummary = {
  /** Note moyenne exacte (non arrondie) — utile pour comparer/trier. */
  average: number;
  /** Note arrondie à une décimale, telle qu'affichée (F1). */
  rounded: number;
  /** Nombre d'avis pris en compte (APPROVED uniquement). */
  count: number;
  /** Répartition 1..5 étoiles. */
  distribution: Record<number, number>;
};

/**
 * Agrège des avis en note moyenne + répartition.
 *
 * LA RÈGLE QUI COMPTE : seuls les avis `APPROVED` comptent. La fonction filtre
 * elle-même sur le statut au lieu de faire confiance à l'appelant : une note
 * moyenne qui inclurait un avis en attente ou rejeté ferait entrer du contenu
 * non modéré dans l'affichage public (D2 du PO-BRIEF V2), et c'est exactement
 * le genre d'erreur qu'un `where` oublié dans une requête produit.
 *
 * Retourne `null` quand il n'y a AUCUN avis approuvé : « un produit neuf
 * n'affiche pas 0,0 ni cinq étoiles vides — un zéro affiché est pire que rien »
 * (F1). Le `null` est la façon de dire « il n'y a rien à afficher », et
 * l'appelant ne peut pas l'ignorer par distraction en lisant `average`.
 */
export function computeRatingSummary(reviews: readonly RatedReview[]): RatingSummary | null {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let total = 0;

  for (const review of reviews) {
    if (review.status !== "APPROVED") continue;
    if (!Number.isInteger(review.rating) || review.rating < MIN_RATING || review.rating > MAX_RATING) {
      // Une note hors bornes en base est une donnée corrompue : on l'ignore
      // plutôt que de laisser une valeur aberrante (6/5) fausser la moyenne.
      continue;
    }
    count += 1;
    total += review.rating;
    distribution[review.rating] = (distribution[review.rating] ?? 0) + 1;
  }

  if (count === 0) return null;

  const average = total / count;
  return {
    average,
    // Arrondi à une décimale (F1). Multiplication par 10 plutôt que `toFixed`
    // pour garder un `number` exploitable, et pas un `Float` de stockage : ce
    // n'est jamais persisté.
    rounded: Math.round(average * 10) / 10,
    count,
    distribution,
  };
}

/** Affichage français de la note : « 4,5 » et non « 4.5 ». */
export function formatRating(rounded: number): string {
  return rounded.toFixed(1).replace(".", ",");
}

/**
 * Balisage `AggregateRating` pour les moteurs de recherche, ou `null`.
 *
 * F1 : présent UNIQUEMENT s'il existe des avis approuvés. Un `AggregateRating`
 * à zéro avis est un signal faux envoyé à Google — et c'est le genre de donnée
 * qu'on ne peut plus retirer une fois indexée.
 *
 * `ratingValue` est une chaîne au format `4.5` (point décimal) : schema.org
 * attend un nombre en notation anglaise, alors que l'affichage humain est
 * français. Les deux ne doivent pas se confondre.
 */
export type AggregateRatingLd = {
  "@type": "AggregateRating";
  ratingValue: string;
  reviewCount: number;
  bestRating: number;
  worstRating: number;
};

export function aggregateRatingJsonLd(summary: RatingSummary | null): AggregateRatingLd | null {
  if (!summary || summary.count === 0) return null;
  return {
    "@type": "AggregateRating",
    ratingValue: summary.rounded.toFixed(1),
    reviewCount: summary.count,
    bestRating: MAX_RATING,
    worstRating: MIN_RATING,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Éligibilité
// ─────────────────────────────────────────────────────────────────────

/**
 * Statuts de commande qui INTERDISENT un avis.
 *
 * Décision de périmètre (PO-BRIEF V2 §3.4) : « on ne peut déposer un avis que
 * sur un produit qu'on a réellement commandé ET dont la commande n'est pas
 * annulée/remboursée ». On suit la règle littéralement : tout statut SAUF ces
 * deux-là ouvre droit à un avis. Une commande en attente de paiement est donc
 * éligible — elle a bien été passée, et le client qui a reçu son article avant
 * l'encaissement (virement en retard) doit pouvoir en parler.
 */
export const BLOCKING_ORDER_STATUSES: readonly OrderStatus[] = ["CANCELLED", "REFUNDED"];

/** `true` si une commande dans cet état peut porter un avis. */
export function isOrderStatusReviewable(status: OrderStatus): boolean {
  return !BLOCKING_ORDER_STATUSES.includes(status);
}

export type ReviewEligibilityCode =
  | "ORDER_CANCELLED"
  | "PRODUCT_NOT_ORDERED"
  | "ALREADY_REVIEWED";

export type ReviewEligibility = { ok: true } | { ok: false; code: ReviewEligibilityCode; message: string };

export type ReviewEligibilityInput = {
  orderStatus: OrderStatus;
  /** `true` si la commande contient bien une ligne de CE produit. */
  productOrdered: boolean;
  /** `true` si ce client a déjà un avis sur ce produit (quel que soit son statut). */
  alreadyReviewed: boolean;
};

/**
 * Décide si un avis peut être déposé, et POURQUOI il ne peut pas.
 *
 * Chaque refus porte un code stable et un message actionnable : Aïcha doit
 * savoir quoi corriger, pas lire « erreur ». C'est la même exigence que pour
 * les raisons de refus d'un code promo (§3.3, E2).
 *
 * L'ordre des contrôles est délibéré : l'état de la commande d'abord (le plus
 * compréhensible pour le client), le doublon ensuite. Un client ayant déjà
 * donné son avis sur une commande remboursée entre-temps lira « commande
 * remboursée », ce qui est la vraie raison du blocage.
 */
export function checkReviewEligibility(input: ReviewEligibilityInput): ReviewEligibility {
  if (!isOrderStatusReviewable(input.orderStatus)) {
    return {
      ok: false,
      code: "ORDER_CANCELLED",
      message:
        input.orderStatus === "REFUNDED"
          ? "Cette commande a été remboursée : un avis ne peut plus y être rattaché."
          : "Cette commande a été annulée : un avis ne peut plus y être rattaché.",
    };
  }

  if (!input.productOrdered) {
    return {
      ok: false,
      code: "PRODUCT_NOT_ORDERED",
      message: "Ce produit ne fait pas partie de cette commande : seuls les articles réellement achetés peuvent être notés.",
    };
  }

  if (input.alreadyReviewed) {
    return {
      ok: false,
      code: "ALREADY_REVIEWED",
      message: "Vous avez déjà déposé un avis sur ce produit. Un seul avis par produit et par client.",
    };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Ancienneté en modération (F3 / KPI K8)
// ─────────────────────────────────────────────────────────────────────

/**
 * Âge d'un avis en attente, en jours entiers.
 *
 * `Math.floor` et non `Math.round` : un avis déposé il y a 6 jours et 23 heures
 * n'a pas « 7 jours ». Le seuil K8 (« 0 avis PENDING de plus de 7 jours ») doit
 * déclencher au 8ᵉ jour, pas au 7ᵉ — sinon le KPI est violé par arrondi, ce qui
 * revient à ne pas le mesurer. Borné à 0 vers le haut : une horloge serveur en
 * retard ne doit pas produire un âge négatif affiché (« -1 jour »).
 */
export function reviewAgeInDays(createdAt: Date, now: Date): number {
  const elapsedMs = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(elapsedMs / 86_400_000));
}

/** `true` si l'avis dépasse le seuil K8 de modération (plus de 7 jours pleins). */
export function isModerationOverdue(createdAt: Date, now: Date): boolean {
  return reviewAgeInDays(createdAt, now) >= MODERATION_OVERDUE_DAYS;
}

/** Libellé humain de l'ancienneté : « aujourd'hui », « 3 jours », « 12 jours ». */
export function formatAgeInDays(days: number): string {
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "1 jour";
  return `${days} jours`;
}
