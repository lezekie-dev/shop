/**
 * Réconciliation des paiements bloqués — LE seul endroit qui réinterroge un
 * fournisseur de paiement pour savoir où en est un paiement `PENDING`.
 *
 * CE QUE CE MODULE NE FAIT PAS (et ne fera jamais)
 * Il ne décide pas du sort de la commande. Le PO a tranché (décision D6) :
 * « l'application ne décide pas à la place du marchand ». Donc aucun appel à
 * un remboursement, aucune annulation de commande, aucune libération de stock
 * réservé. Un paiement qui reste `PENDING` après toutes les tentatives remonte
 * simplement en tête de `/admin/paiements` avec la mention « à traiter
 * manuellement ». Libérer un stock réservé automatiquement peut le faire vendre
 * deux fois ; annuler une commande automatiquement peut annuler une vente
 * payée cinq minutes plus tard.
 *
 * Il ne réimplémente AUCUNE transition de paiement : le verdict du fournisseur
 * passe par `applyPaymentOutcome()` (src/server/payments.ts), la fonction
 * unique et idempotente déjà utilisée par le checkout, le callback Mobile Money
 * et la validation manuelle du virement. C'est ce qui garantit qu'une
 * réconciliation ne peut pas, par exemple, décrémenter deux fois le stock ou
 * rétrograder un paiement déjà confirmé.
 *
 * TROIS PROPRIÉTÉS TENUES PAR CONSTRUCTION
 *  1. Idempotence : rejouer la réconciliation sur un paiement déjà confirmé ne
 *     produit ni second décrément de stock, ni second email (c'est
 *     `applyPaymentOutcome` qui le garantit, et un test qui le prouve).
 *  2. Une erreur sur UN paiement n'interrompt pas le lot : à 100 paiements en
 *     attente, un fournisseur injoignable ne doit pas empêcher les 99 autres
 *     d'être réconciliés.
 *  3. Exactement un `JobRun` par exécution, y compris en échec — un job qui
 *     échoue en silence chaque nuit est un job que personne ne répare.
 */

import type { JobStatus, OrderStatus, PaymentStatus } from "@prisma/client";

import {
  computeNextReconcileAt,
  countVerdict,
  emptyReconcileMeta,
  RECONCILE_BATCH_SIZE,
  RECONCILE_JOB_NAME,
  reconcileDelayMinutes,
  type ReconcileJobMeta,
  type ReconcileVerdict,
} from "@/domain/payment/reconciliation";
import type { PaymentProvider } from "@/domain/payment/provider";
import { selectPaymentProvider } from "@/domain/payment/registry";
import { prisma } from "@/lib/db";
import { applyPaymentOutcome, PaymentError } from "@/server/payments";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/** Paiement à réconcilier, réduit à ce dont la vérification a besoin. */
export type ReconcileTarget = {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  /** Statut courant de la commande (affiché tel quel dans le résultat). */
  orderStatus: OrderStatus;
  /** Statut courant du paiement — sert au cas « plus en attente ». */
  paymentStatus: PaymentStatus;
  /** Nom du fournisseur d'origine du paiement (`mock`, `mobile_money`…). */
  provider: string;
  providerRef: string;
  reconcileAttempts: number;
  nextReconcileAt: Date | null;
};

/** Résultat d'UNE vérification, prêt à afficher au marchand. */
export type PaymentReconcileResult = {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  providerRef: string;
  verdict: ReconcileVerdict;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  /** `true` = l'état était déjà celui demandé, AUCUNE écriture métier faite. */
  idempotent: boolean;
  /** Compteur APRÈS cette vérification. */
  reconcileAttempts: number;
  /** `null` quand le paiement n'est plus en attente (plus rien à planifier). */
  nextReconcileAt: Date | null;
  /** Phrase en clair pour l'écran — jamais un code d'erreur brut. */
  message: string;
};

/** Résultat d'une exécution complète de la tâche. */
export type ReconcileJobResult = {
  jobRunId: string;
  status: JobStatus;
  meta: ReconcileJobMeta;
  error: string | null;
  results: PaymentReconcileResult[];
};

/**
 * Dépendances injectables.
 *
 * `now` et `providerFor` existent pour deux besoins RÉELS et non pour le test :
 *   - `now` : le backoff se teste en avançant l'horloge, pas en attendant 24 h ;
 *   - `providerFor` : le registre ne sait pas simuler un fournisseur dont la
 *     réponse a CHANGÉ depuis le callback (un cas réel : un premier sondage voit
 *     un échec, le callback suivant confirme le paiement). Sans ce point
 *     d'injection, ce scénario n'est pas testable, donc pas garanti.
 *   - `selectDuePayments` : la sélection est une requête ; pouvoir la remplacer
 *     permet de vérifier que l'échec de la SÉLECTION produit bien un `JobRun`
 *     FAILED avec son message, ce qui est exactement ce qu'on veut voir dans le
 *     back-office le jour où la base tombe.
 */
export type ReconcileDeps = {
  now?: Date;
  providerFor?: (name: string) => PaymentProvider;
  selectDuePayments?: (params: { now: Date; take: number }) => Promise<ReconcileTarget[]>;
};

const TARGET_SELECT = {
  id: true,
  orderId: true,
  provider: true,
  providerRef: true,
  status: true,
  reconcileAttempts: true,
  nextReconcileAt: true,
  order: { select: { number: true, status: true } },
} as const;

type TargetRow = {
  id: string;
  orderId: string;
  provider: string;
  providerRef: string;
  status: PaymentStatus;
  reconcileAttempts: number;
  nextReconcileAt: Date | null;
  order: { number: string; status: OrderStatus };
};

function toTarget(row: TargetRow): ReconcileTarget {
  return {
    paymentId: row.id,
    orderId: row.orderId,
    orderNumber: row.order.number,
    orderStatus: row.order.status,
    paymentStatus: row.status,
    provider: row.provider,
    providerRef: row.providerRef,
    reconcileAttempts: row.reconcileAttempts,
    nextReconcileAt: row.nextReconcileAt,
  };
}

/** « 2 min », « 24 h » — lisible par un marchand, pas par un cron. */
function formatDelay(attempts: number): string {
  const minutes = reconcileDelayMinutes(attempts);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

// ─────────────────────────────────────────────────────────────────────
// Sélection des paiements à réconcilier
// ─────────────────────────────────────────────────────────────────────

/**
 * Paiements `PENDING` dont la vérification est DUE, du plus urgent au moins
 * urgent.
 *
 * `nextReconcileAt` NULL compte comme dû : un paiement créé par le checkout
 * sans planification (le cas des paiements déjà en base) n'a jamais été
 * interrogé, donc il doit l'être MAINTENANT — l'exclure reviendrait à laisser
 * un paiement bloqué pour toujours, précisément ce que ce chantier corrige.
 * Ces lignes passent en premier (`nulls: "first"`), puis les plus anciens.
 *
 * La requête reste adossée à l'index `[status, nextReconcileAt]` : le filtre
 * porte sur ces deux colonnes, dans cet ordre.
 */
export async function listDuePayments(params: {
  now: Date;
  take?: number;
}): Promise<ReconcileTarget[]> {
  const rows = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextReconcileAt: null }, { nextReconcileAt: { lte: params.now } }],
    },
    orderBy: [
      { nextReconcileAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
    take: params.take ?? RECONCILE_BATCH_SIZE,
    select: TARGET_SELECT,
  });
  return rows.map(toTarget);
}

// ─────────────────────────────────────────────────────────────────────
// Vérification d'UN paiement
// ─────────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof PaymentError) return `${err.code} — ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function buildMessage(params: {
  verdict: ReconcileVerdict;
  orderNumber: string;
  idempotent: boolean;
  detail: string | null;
  nextAttempts: number;
}): string {
  const { verdict, orderNumber, idempotent, detail, nextAttempts } = params;
  switch (verdict) {
    case "succeeded":
      return idempotent
        ? `Paiement déjà confirmé avant cette vérification : la commande ${orderNumber} était payée, aucune écriture (ni stock, ni email).`
        : `Paiement confirmé : la commande ${orderNumber} est payée. Le stock réservé a été décrémenté et l'email de confirmation envoyé.`;
    case "pending":
      return `Le fournisseur ne s'est pas encore prononcé. La commande ${orderNumber} reste en attente ; prochaine vérification automatique dans ${formatDelay(nextAttempts)}.`;
    case "failed":
      return `Le fournisseur déclare le paiement en échec. La commande ${orderNumber} N'EST PAS annulée et le stock réservé N'EST PAS libéré : c'est au marchand de trancher (décision D6).`;
    case "error":
      return `Vérification impossible (${detail ?? "cause inconnue"}). Nouvelle tentative automatique dans ${formatDelay(nextAttempts)}.`;
    case "not_pending":
      return `Ce paiement n'est plus en attente : aucune vérification effectuée.`;
  }
}

/**
 * Réinterroge le fournisseur d'ORIGINE du paiement et applique son verdict via
 * la transition unique `applyPaymentOutcome`.
 *
 * Le backoff est écrit APRÈS la transition, avec `attempts + 1` : la ligne
 * payée n'est plus jamais re-sélectionnée (statut ≠ PENDING), donc son
 * `nextReconcileAt` est remis à `null` — un « prochaine vérification » affiché
 * sur un paiement soldé ferait croire à une tâche qui tourne dans le vide.
 */
export async function reconcilePayment(
  target: ReconcileTarget,
  options: { now?: Date; providerFor?: (name: string) => PaymentProvider } = {},
): Promise<PaymentReconcileResult> {
  const now = options.now ?? new Date();
  const providerFor = options.providerFor ?? selectPaymentProvider;

  let verdict: ReconcileVerdict;
  let idempotent = false;
  let detail: string | null = null;

  try {
    const provider = providerFor(target.provider);
    const capture = await provider.capture(target.providerRef);
    const outcome = await applyPaymentOutcome(target.orderId, target.providerRef, capture.status);
    verdict = capture.status;
    idempotent = outcome.idempotent;
  } catch (err) {
    // On ne devine pas « en attente » ni « échoué » quand on ne sait pas : un
    // statut inventé est pire qu'un statut inconnu, parce qu'il ne se voit pas.
    verdict = "error";
    detail = errorMessage(err);
  }

  // Relecture de l'état RÉEL après transition : on n'affiche jamais un statut
  // déduit de ce qu'on a demandé, seulement de ce qui est en base.
  const after = await prisma.payment.findUniqueOrThrow({
    where: { id: target.paymentId },
    select: { status: true, order: { select: { status: true } } },
  });

  const nextAttempts = target.reconcileAttempts + 1;
  const stillPending = after.status === "PENDING";
  const nextReconcileAt = stillPending ? computeNextReconcileAt(now, nextAttempts) : null;

  await prisma.payment.update({
    where: { id: target.paymentId },
    data: {
      // `increment` et non une valeur absolue : si deux exécutions se
      // chevauchent (cron + bouton « Vérifier maintenant »), le compteur
      // compte bien les deux interrogations au lieu d'en perdre une.
      reconcileAttempts: { increment: 1 },
      lastCheckedAt: now,
      nextReconcileAt,
    },
  });

  return {
    paymentId: target.paymentId,
    orderId: target.orderId,
    orderNumber: target.orderNumber,
    providerRef: target.providerRef,
    verdict,
    paymentStatus: after.status,
    orderStatus: after.order.status,
    idempotent,
    reconcileAttempts: nextAttempts,
    nextReconcileAt,
    message: buildMessage({ verdict, orderNumber: target.orderNumber, idempotent, detail, nextAttempts }),
  };
}

/**
 * « Vérifier maintenant » — un SEUL paiement, à la demande, sans attendre la
 * prochaine exécution. Renvoie `null` si l'identifiant n'existe pas (l'appelant
 * en fait un 404).
 *
 * Un paiement qui n'est plus `PENDING` n'est PAS réinterrogé : il n'y a plus
 * rien à vérifier, et interroger le fournisseur sur un paiement soldé ne peut
 * que produire un verdict tardif qu'on refuserait ensuite d'appliquer — du
 * bruit pour l'opérateur, et un appel réseau pour rien.
 */
export async function reconcilePaymentById(
  paymentId: string,
  options: { now?: Date; providerFor?: (name: string) => PaymentProvider } = {},
): Promise<PaymentReconcileResult | null> {
  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: TARGET_SELECT,
  });
  if (!row) return null;

  const target = toTarget(row);
  if (target.paymentStatus !== "PENDING") {
    return {
      paymentId: target.paymentId,
      orderId: target.orderId,
      orderNumber: target.orderNumber,
      providerRef: target.providerRef,
      verdict: "not_pending",
      paymentStatus: target.paymentStatus,
      orderStatus: target.orderStatus,
      idempotent: true,
      reconcileAttempts: target.reconcileAttempts,
      nextReconcileAt: target.nextReconcileAt,
      message: buildMessage({
        verdict: "not_pending",
        orderNumber: target.orderNumber,
        idempotent: true,
        detail: null,
        nextAttempts: target.reconcileAttempts,
      }),
    };
  }

  return reconcilePayment(target, options);
}

// ─────────────────────────────────────────────────────────────────────
// La tâche
// ─────────────────────────────────────────────────────────────────────

/**
 * Exécute la tâche `reconcile-payments` et écrit EXACTEMENT un `JobRun`.
 *
 * Deux niveaux d'erreur, volontairement distincts :
 *   - l'échec d'UN paiement est absorbé (compté dans `meta.failed` et résumé
 *     dans `error`), parce qu'un fournisseur en panne ne doit pas empêcher le
 *     traitement des autres ;
 *   - l'échec de l'exécution elle-même (sélection impossible, base tombée)
 *     donne un `JobRun` FAILED avec son message : c'est le signal qu'un humain
 *     doit voir dans `/admin/taches`.
 *
 * Si la création du `JobRun` échoue (base injoignable), l'erreur remonte : il
 * n'y a alors aucun endroit où l'écrire, et prétendre le contraire serait un
 * mensonge silencieux.
 */
export async function runPaymentReconciliationJob(
  deps: ReconcileDeps = {},
): Promise<ReconcileJobResult> {
  const now = deps.now ?? new Date();
  const providerFor = deps.providerFor;
  const selectDuePayments = deps.selectDuePayments ?? listDuePayments;

  const run = await prisma.jobRun.create({
    data: {
      name: RECONCILE_JOB_NAME,
      status: "RUNNING",
      // `startedAt` vient de `now` (horloge logique de l'exécution), tandis que
      // `finishedAt` est l'heure réelle : c'est la seule mesure de durée
      // honnête, et elle reste positive même quand un test simule le passé.
      startedAt: now,
    },
    select: { id: true },
  });

  let meta = emptyReconcileMeta();
  const results: PaymentReconcileResult[] = [];
  const failures: string[] = [];

  try {
    const targets = await selectDuePayments({ now, take: RECONCILE_BATCH_SIZE });

    for (const target of targets) {
      try {
        const result = await reconcilePayment(target, {
          now,
          ...(providerFor ? { providerFor } : {}),
        });
        results.push(result);
        meta = countVerdict(meta, result.verdict);
        if (result.verdict === "error") {
          failures.push(`${result.orderNumber} : ${result.message}`);
        }
      } catch (err) {
        meta = countVerdict(meta, "error");
        failures.push(`${target.orderNumber} : ${errorMessage(err)}`);
      }
    }

    // Le résumé est borné : un message d'erreur de 3 pages dans la colonne
    // `error` rend la page des tâches illisible, donc inutile.
    const error =
      failures.length > 0
        ? `${failures.length} paiement(s) n'ont pas pu être vérifiés — ${failures.slice(0, 3).join(" | ")}`
        : null;

    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        meta,
        ...(error ? { error } : {}),
      },
    });

    return { jobRunId: run.id, status: "SUCCEEDED", meta, error, results };
  } catch (err) {
    const message = errorMessage(err);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: message, meta },
    });
    return { jobRunId: run.id, status: "FAILED", meta, error: message, results };
  }
}
