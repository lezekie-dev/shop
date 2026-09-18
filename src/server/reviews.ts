import { Prisma, type OrderStatus, type ReviewStatus } from "@prisma/client";

import {
  checkReviewEligibility,
  computeRatingSummary,
  MODERATION_OVERDUE_DAYS,
  validateReviewInput,
  type RatingSummary,
  type ReviewFieldError,
} from "@/domain/review";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/server/audit-log";

/**
 * Avis clients — orchestration base de données (chantier F, lot 2B).
 *
 * PÉRIMÈTRE FIXÉ PAR LE PO (PO-BRIEF V2 §3.4) — ce fichier ne le dépasse pas :
 *   - un avis est TOUJOURS rattaché à une commande (donc preuve d'achat) ;
 *   - la modération est obligatoire : rien n'est public avant `APPROVED` ;
 *   - pas de photo, pas de réponse publique de la marchande.
 *
 * LES DEUX DÉFENSES STRUCTURANTES DE CE MODULE :
 *
 * 1. UN `orderId` REÇU DU CLIENT N'EST JAMAIS UNE PREUVE. La commande est
 *    relue avec `where: { id, customerId }` — le `customerId` venant de la
 *    session, jamais du corps de la requête. Sans ce filtre, n'importe qui
 *    pourrait déposer un avis « achat vérifié » sur la commande d'un autre en
 *    devinant un id. C'est la faille la plus courante de cette fonctionnalité.
 *
 * 2. RIEN NE SORT EN DEHORS DE `APPROVED`. Les lectures publiques filtrent sur
 *    le statut DANS la requête (`where: { status: "APPROVED" }`) et le calcul
 *    de moyenne refiltre dans le domaine : un `where` oublié ici ne suffit pas
 *    à publier un avis non modéré.
 *
 * Une commande appartenant à quelqu'un d'autre renvoie « introuvable » (404) et
 * non « interdit » (403), comme partout ailleurs dans l'espace client : un 403
 * confirmerait l'existence de la commande à qui énumère des identifiants.
 */

/** Avis affichés par page sur la fiche produit (F1 : pagination). */
export const PUBLIC_REVIEWS_PAGE_SIZE = 5;
/** Lignes affichées par page dans la file de modération. */
export const MODERATION_QUEUE_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────
// Lecture publique (F1)
// ─────────────────────────────────────────────────────────────────────

export type PublishedReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  createdAt: Date;
  /** `true` quand l'avis est rattaché à une commande → mention « Achat vérifié ». */
  verifiedPurchase: boolean;
};

export type PublishedReviewsPage = {
  reviews: PublishedReview[];
  page: number;
  pageCount: number;
  total: number;
};

/**
 * Avis PUBLIÉS d'un produit, les plus récents d'abord.
 *
 * Le filtre `status: "APPROVED"` est dans la requête ET non appliqué après
 * coup : la pagination compte ainsi uniquement les avis publiables, sinon une
 * page pourrait afficher « 1 avis » en n'en montrant aucun (les autres étant
 * en attente). C'est le genre d'incohérence qui fait perdre confiance dans la
 * note affichée.
 */
export async function listPublishedReviews(
  productId: string,
  options: { page?: number } = {},
): Promise<PublishedReviewsPage> {
  const requested = Number.isFinite(options.page) ? Math.floor(options.page ?? 1) : 1;

  const total = await prisma.review.count({ where: { productId, status: "APPROVED" } });
  const pageCount = Math.max(1, Math.ceil(total / PUBLIC_REVIEWS_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);

  const rows = await prisma.review.findMany({
    where: { productId, status: "APPROVED" },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PUBLIC_REVIEWS_PAGE_SIZE,
    take: PUBLIC_REVIEWS_PAGE_SIZE,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      createdAt: true,
      orderId: true,
    },
  });

  return {
    page,
    pageCount,
    total,
    reviews: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      authorName: row.authorName,
      createdAt: row.createdAt,
      verifiedPurchase: row.orderId !== null,
    })),
  };
}

/**
 * Note moyenne + nombre d'avis publiés d'un produit, ou `null` s'il n'y a
 * aucun avis publié (F1 : on n'affiche pas « 0,0 »).
 *
 * On ne fait pas confiance à un `aggregate` SQL pour la moyenne : le calcul
 * (arrondi à une décimale, répartition) vit dans `src/domain/review.ts`, où il
 * est testé sans base. La requête ne ramène que deux champs, et la fiche
 * produit affiche quelques dizaines d'avis au maximum — le volume d'un produit
 * de cette boutique (100–500 commandes/mois).
 */
export async function getProductRatingSummary(productId: string): Promise<RatingSummary | null> {
  const rows = await prisma.review.findMany({
    where: { productId, status: "APPROVED" },
    select: { rating: true, status: true },
  });
  return computeRatingSummary(rows);
}

// ─────────────────────────────────────────────────────────────────────
// Dépôt d'un avis (F2)
// ─────────────────────────────────────────────────────────────────────

export type ReviewSubmissionFailureCode =
  | "INVALID_INPUT"
  | "ORDER_NOT_FOUND"
  | "PRODUCT_NOT_ORDERED"
  | "ORDER_CANCELLED"
  | "ALREADY_REVIEWED";

export type ReviewMutationFailure = {
  ok: false;
  code: ReviewSubmissionFailureCode;
  /** Message destiné à l'humain, actionnable. */
  message: string;
  status: number;
  /** Erreurs par champ, quand la saisie est en cause. */
  errors: ReviewFieldError[];
};

export type ReviewSubmissionResult =
  | { ok: true; review: { id: string; status: ReviewStatus; productId: string } }
  | ReviewMutationFailure;

export type SubmitReviewInput = {
  /** Client connecté — vient de la session, JAMAIS du corps de la requête. */
  customerId: string;
  /** Commande déclarée par le client : relue et vérifiée avant tout écriture. */
  orderId: string;
  productId: string;
  rating: number;
  title?: string | null;
  body: string;
  authorName: string;
};

/**
 * Dépose un avis. Ordre des contrôles, et pourquoi :
 *   1. validation de la saisie (pure) — inutile d'interroger la base pour un
 *      texte vide ;
 *   2. la commande existe ET appartient au client (sinon 404, sans dire
 *      pourquoi) ;
 *   3. le produit fait bien partie de cette commande ;
 *   4. la commande n'est ni annulée ni remboursée ;
 *   5. pas de doublon client/produit ;
 *   6. écriture en `PENDING` — un avis n'est jamais créé publié.
 *
 * Le doublon est contrôlé AVANT l'insertion pour donner un message clair, et la
 * contrainte `@@unique([productId, customerId])` reste le filet en cas de
 * double soumission concurrente (deux clics rapides) : l'erreur `P2002` est
 * traduite en message utilisateur, jamais renvoyée en 500.
 */
export async function submitReview(input: SubmitReviewInput): Promise<ReviewSubmissionResult> {
  const validation = validateReviewInput({
    rating: input.rating,
    title: input.title,
    body: input.body,
    authorName: input.authorName,
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "L'avis n'a pas pu être enregistré : corrigez les champs signalés.",
      status: 400,
      errors: validation.errors,
    };
  }

  // ── 2. La commande appartient-elle VRAIMENT au client connecté ?
  // `customerId` vient de la session. C'est ce `where` — et lui seul — qui
  // empêche de déposer un avis sur la commande d'un autre client.
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, customerId: input.customerId },
    select: {
      id: true,
      status: true,
      items: { select: { variant: { select: { productId: true } } } },
    },
  });

  if (!order) {
    return {
      ok: false,
      code: "ORDER_NOT_FOUND",
      message: "Commande introuvable. Un avis doit être déposé depuis l'une de vos propres commandes.",
      status: 404,
      errors: [],
    };
  }

  const productOrdered = order.items.some((item) => item.variant.productId === input.productId);

  const existing = await prisma.review.findFirst({
    where: { productId: input.productId, customerId: input.customerId },
    select: { id: true, status: true },
  });

  const eligibility = checkReviewEligibility({
    orderStatus: order.status,
    productOrdered,
    alreadyReviewed: existing !== null,
  });
  if (!eligibility.ok) {
    return {
      ok: false,
      code: eligibility.code,
      message: eligibility.message,
      // Un doublon est un conflit d'état (409) ; le reste est un refus métier
      // sur la ressource visée (422 serait défendable, on reste sur 409 pour
      // que le client distingue « conflit » de « saisie invalide »).
      status: eligibility.code === "ALREADY_REVIEWED" ? 409 : 422,
      errors: [],
    };
  }

  try {
    const created = await prisma.review.create({
      data: {
        productId: input.productId,
        customerId: input.customerId,
        orderId: order.id,
        // Le nom affiché est saisi par le client : c'est son choix de signer
        // « Aïcha N. » ou autrement, la boutique n'impose pas l'email.
        authorName: validation.value.authorName,
        rating: validation.value.rating,
        title: validation.value.title,
        body: validation.value.body,
        status: "PENDING",
      },
      select: { id: true, status: true, productId: true },
    });
    return { ok: true, review: created };
  } catch (error) {
    // Filet de la contrainte d'unicité : deux soumissions simultanées du même
    // client sur le même produit. Sans cette traduction, le client verrait un
    // 500 pour un double clic.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        ok: false,
        code: "ALREADY_REVIEWED",
        message: "Vous avez déjà déposé un avis sur ce produit. Un seul avis par produit et par client.",
        status: 409,
        errors: [],
      };
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Espace client : de quoi ai-je le droit de parler ? (F2)
// ─────────────────────────────────────────────────────────────────────

export type OrderReviewCandidate = {
  productId: string;
  productName: string;
  productSlug: string;
  /** Noms des variantes achetées de ce produit, pour que le client reconnaisse l'article. */
  variantNames: string[];
  /** Avis déjà déposé par ce client sur ce produit, quel que soit son statut. */
  review: { id: string; status: ReviewStatus } | null;
};

export type OrderReviewCandidates = {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  candidates: OrderReviewCandidate[];
};

/**
 * Produits d'UNE commande du client, avec l'avis éventuellement déjà déposé.
 *
 * Sert la page « Laisser un avis » de l'espace client : elle doit dire à
 * l'avance ce qui est possible (un article pas encore noté → formulaire ; un
 * article déjà noté → état de l'avis), au lieu de laisser le client remplir un
 * formulaire qui sera refusé. Retourne `null` si la commande n'appartient pas au
 * client — l'appelant traduit en 404.
 */
export async function listOrderReviewCandidates(
  customerId: string,
  orderId: string,
): Promise<OrderReviewCandidates | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    select: {
      id: true,
      number: true,
      status: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          quantity: true,
          variant: {
            select: { name: true, product: { select: { id: true, name: true, slug: true } } },
          },
        },
      },
    },
  });
  if (!order) return null;

  // Regroupement par PRODUIT et non par variante : la contrainte d'unicité est
  // « un avis par produit », donc commander le même article en deux tailles ne
  // doit pas proposer deux formulaires (dont le second serait refusé).
  const grouped = new Map<string, OrderReviewCandidate>();
  for (const item of order.items) {
    const product = item.variant.product;
    const existing = grouped.get(product.id);
    if (existing) {
      existing.variantNames.push(item.variant.name);
      continue;
    }
    grouped.set(product.id, {
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      variantNames: [item.variant.name],
      review: null,
    });
  }

  const productIds = [...grouped.keys()];
  if (productIds.length > 0) {
    const reviews = await prisma.review.findMany({
      where: { customerId, productId: { in: productIds } },
      select: { id: true, productId: true, status: true },
    });
    for (const review of reviews) {
      const candidate = grouped.get(review.productId);
      if (candidate) candidate.review = { id: review.id, status: review.status };
    }
  }

  return {
    orderId: order.id,
    orderNumber: order.number,
    orderStatus: order.status,
    candidates: [...grouped.values()],
  };
}

// ─────────────────────────────────────────────────────────────────────
// File de modération (F3)
// ─────────────────────────────────────────────────────────────────────

export type ModerationQueueRow = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string;
  createdAt: Date;
  status: ReviewStatus;
  product: { id: string; name: string; slug: string };
  /** Email du client — la seule donnée personnelle nécessaire pour situer l'avis. */
  customerEmail: string | null;
  orderNumber: string | null;
  /** `true` si un modérateur a déjà statué (avis `PENDING` : toujours `false`). */
  moderatedAt: Date | null;
};

export type ModerationQueuePage = {
  rows: ModerationQueueRow[];
  page: number;
  pageCount: number;
  total: number;
  status: ReviewStatus;
};

/**
 * File de modération, filtrée par statut (`PENDING` par défaut).
 *
 * Tri : les PENDING les PLUS ANCIENS d'abord. C'est l'inverse de la file
 * publique, et c'est volontaire : une file triée du plus récent au plus ancien
 * laisse pourrir l'avis du bas, exactement celui qui déclenche le KPI K8. On
 * modère ce qui attend depuis le plus longtemps.
 */
export async function listModerationQueue(
  options: { status?: ReviewStatus; page?: number } = {},
): Promise<ModerationQueuePage> {
  const status: ReviewStatus = options.status ?? "PENDING";
  const requested = Number.isFinite(options.page) ? Math.floor(options.page ?? 1) : 1;

  const total = await prisma.review.count({ where: { status } });
  const pageCount = Math.max(1, Math.ceil(total / MODERATION_QUEUE_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);

  const rows = await prisma.review.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    skip: (page - 1) * MODERATION_QUEUE_PAGE_SIZE,
    take: MODERATION_QUEUE_PAGE_SIZE,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      createdAt: true,
      status: true,
      moderatedAt: true,
      product: { select: { id: true, name: true, slug: true } },
      customer: { select: { email: true } },
      order: { select: { number: true } },
    },
  });

  return {
    status,
    page,
    pageCount,
    total,
    rows: rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      authorName: row.authorName,
      createdAt: row.createdAt,
      status: row.status,
      product: row.product,
      customerEmail: row.customer?.email ?? null,
      orderNumber: row.order?.number ?? null,
      moderatedAt: row.moderatedAt,
    })),
  };
}

export type PendingReviewCounters = {
  pending: number;
  /** Avis en attente depuis plus de `MODERATION_OVERDUE_DAYS` jours (KPI K8). */
  overdue: number;
};

/**
 * Compteurs de la file d'attente.
 *
 * `overdue` est calculé par une borne de date en base plutôt qu'en mémoire :
 * le compteur doit rester juste même si la file dépasse une page (20 lignes) —
 * et c'est précisément quand la file déborde qu'il est le plus utile.
 */
export async function countPendingReviews(now: Date = new Date()): Promise<PendingReviewCounters> {
  const cutoff = new Date(now.getTime() - MODERATION_OVERDUE_DAYS * 86_400_000);
  const [pending, overdue] = await Promise.all([
    prisma.review.count({ where: { status: "PENDING" } }),
    prisma.review.count({ where: { status: "PENDING", createdAt: { lte: cutoff } } }),
  ]);
  return { pending, overdue };
}

// ─────────────────────────────────────────────────────────────────────
// Modération (F3)
// ─────────────────────────────────────────────────────────────────────

export type ModerationDecision = "approve" | "reject";

export type ModerationFailureCode = "NOT_FOUND" | "ALREADY_MODERATED" | "INVALID_DECISION";

export type ModerationResult =
  | { ok: true; review: { id: string; status: ReviewStatus; moderatedAt: Date } }
  | { ok: false; code: ModerationFailureCode; message: string; status: number };

/**
 * Approuve ou rejette un avis, et journalise l'acte.
 *
 * TROIS POINTS DE CONCEPTION :
 *
 * 1. `moderatedById` + `moderatedAt` sont écrits dans le MÊME `update` que le
 *    statut : un avis approuvé sans trace de qui l'a approuvé n'est pas
 *    modérable au sens du PO (« qui a approuvé quoi est traçable », R5). Le
 *    schéma n'a pas de colonne pour le motif de rejet : le motif libre demandé
 *    par F3 va donc dans l'`AuditLog`, avec l'acteur et le diff — là où il est
 *    de toute façon le plus utile (une trace, pas un champ de contenu).
 *
 * 2. La transition est un COMPARE-AND-SET (`updateMany where status = PENDING`),
 *    pas un `update` par id : deux modérateurs qui cliquent en même temps ne
 *    peuvent pas statuer deux fois sur le même avis, et le second reçoit un
 *    message clair au lieu d'écraser silencieusement la décision du premier.
 *
 * 3. Le journal d'audit est écrit DANS la même transaction que la décision
 *    (cf. `writeAuditLog`) : on ne peut pas avoir un avis modéré sans trace, ni
 *    une trace sans modification. Pas de `Serializable` ici — la transaction ne
 *    touche ni `Stock` ni `Order.status` (CONVENTIONS §12 : ce niveau est requis
 *    pour le stock et les transitions de commande), et le CAS rend la course
 *    inoffensive.
 */
export async function moderateReview(input: {
  actorId: string;
  reviewId: string;
  decision: ModerationDecision;
  /** Motif libre, pertinent pour un rejet. */
  reason?: string | null;
}): Promise<ModerationResult> {
  const status: ReviewStatus = input.decision === "approve" ? "APPROVED" : "REJECTED";

  const before = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { id: true, status: true, productId: true, rating: true, customerId: true },
  });
  if (!before) {
    return { ok: false, code: "NOT_FOUND", message: "Avis introuvable.", status: 404 };
  }
  if (before.status !== "PENDING") {
    return {
      ok: false,
      code: "ALREADY_MODERATED",
      message:
        before.status === "APPROVED"
          ? "Cet avis est déjà publié : il a été approuvé par un autre modérateur."
          : "Cet avis a déjà été rejeté par un autre modérateur.",
      status: 409,
    };
  }

  const now = new Date();
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";

  const applied = await prisma.$transaction(async (tx) => {
    const updated = await tx.review.updateMany({
      where: { id: input.reviewId, status: "PENDING" },
      data: { status, moderatedById: input.actorId, moderatedAt: now },
    });
    if (updated.count === 0) return false;

    await writeAuditLog(tx, {
      userId: input.actorId,
      action: input.decision === "approve" ? "review.approve" : "review.reject",
      entity: "Review",
      entityId: input.reviewId,
      diff: {
        productId: before.productId,
        rating: before.rating,
        customerId: before.customerId,
        from: before.status,
        to: status,
        // Motif libre : vide pour une approbation, texte du modérateur pour un
        // rejet. Jamais tronqué à l'aveugle : c'est la seule trace du « pourquoi ».
        reason,
      },
    });
    return true;
  });

  if (!applied) {
    return {
      ok: false,
      code: "ALREADY_MODERATED",
      message: "Cet avis vient d'être modéré par quelqu'un d'autre. Rechargez la page.",
      status: 409,
    };
  }

  return { ok: true, review: { id: input.reviewId, status, moderatedAt: now } };
}
