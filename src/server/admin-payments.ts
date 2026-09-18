/**
 * Lecture des paiements en attente pour le back-office (`/admin/paiements`).
 *
 * POURQUOI CE MODULE
 * La page ne peut pas interroger Prisma directement (CONVENTIONS §2), et la
 * question qu'elle pose au marchand — « quels paiements ne dois-je PAS
 * expédier ? » — mérite d'être testable sans rendre de composant.
 *
 * Ce que la page affiche est EXACTEMENT ce qui a été lu : l'âge en heures et le
 * drapeau « à traiter manuellement » sont calculés à partir de `createdAt` et
 * `reconcileAttempts` par les fonctions pures de
 * `src/domain/payment/reconciliation.ts`. Rien n'est recalculé à l'affichage,
 * sinon l'écran et la tâche planifiée finiraient par ne plus dire la même chose.
 */

import type { OrderStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  isStalePending,
  needsManualReview,
  paymentAgeHours,
  RECONCILE_MAX_ATTEMPTS,
  STALE_PAYMENT_HOURS,
} from "@/domain/payment/reconciliation";

/**
 * Nombre de paiements affichés d'un coup.
 *
 * La boutique vise 100–500 commandes/mois : au-delà de 200 paiements en attente,
 * le problème n'est plus la pagination mais le fait que rien n'est encaissé. On
 * affiche les 200 plus anciens (les plus urgents) et le total réel est écrit à
 * l'écran — une troncature silencieuse ferait croire à un nettoyage.
 */
export const PENDING_PAYMENTS_LIMIT = 200;

export type PendingPaymentRow = {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  /** Statut de la COMMANDE — conditionne la disponibilité de « Marquer payé ». */
  orderStatus: OrderStatus;
  customerName: string;
  amountCents: number;
  currency: string;
  provider: string;
  providerRef: string;
  createdAt: Date;
  /** Âge en heures pleines — l'unité demandée par le PO (KPI K9). */
  ageHours: number;
  reconcileAttempts: number;
  lastCheckedAt: Date | null;
  nextReconcileAt: Date | null;
  /** `true` = le backoff est au plafond : la machine a fait son possible. */
  needsManualReview: boolean;
  /** `true` = en attente depuis plus de 24 h (cible K9 : 0). */
  stale: boolean;
};

export type PendingPaymentsView = {
  rows: PendingPaymentRow[];
  /** Total réel des paiements en attente, même au-delà de la limite affichée. */
  total: number;
};

/**
 * Nom d'affichage d'un client : prénom + nom si renseignés, sinon l'email.
 *
 * Dupliqué depuis `admin-orders.ts` (où il est privé) plutôt que de le rendre
 * public : ce fichier-ci ne doit pas dépendre du module des commandes, que
 * d'autres chantiers de la vague 2 modifient.
 */
function displayName(customer: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const name = [customer.firstName, customer.lastName]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
  return name || customer.email;
}

/** Contexte d'horloge : l'heure est un paramètre, jamais implicite en test. */
export type PaymentsClock = { now?: Date };

/** Paiements `PENDING`, du PLUS ANCIEN au plus récent (âge décroissant). */
export async function listPendingPayments(
  clock: PaymentsClock = {},
): Promise<PendingPaymentsView> {
  const now = clock.now ?? new Date();

  const where = { status: "PENDING" } as const;

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      // L'ordre est la réponse à la question du marchand : ce qui traîne depuis
      // le plus longtemps est ce qui coûte le plus cher (stock réservé et
      // client sans nouvelle).
      orderBy: { createdAt: "asc" },
      take: PENDING_PAYMENTS_LIMIT,
      select: {
        id: true,
        orderId: true,
        provider: true,
        providerRef: true,
        amountCents: true,
        currency: true,
        createdAt: true,
        reconcileAttempts: true,
        lastCheckedAt: true,
        nextReconcileAt: true,
        order: {
          select: {
            number: true,
            status: true,
            customer: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      paymentId: row.id,
      orderId: row.orderId,
      orderNumber: row.order.number,
      orderStatus: row.order.status,
      customerName: displayName(row.order.customer),
      amountCents: row.amountCents,
      currency: row.currency,
      provider: row.provider,
      providerRef: row.providerRef,
      createdAt: row.createdAt,
      ageHours: paymentAgeHours(row.createdAt, now),
      reconcileAttempts: row.reconcileAttempts,
      lastCheckedAt: row.lastCheckedAt,
      nextReconcileAt: row.nextReconcileAt,
      needsManualReview: needsManualReview(row),
      stale: isStalePending(row.createdAt, now),
    })),
  };
}

/**
 * Compteur d'en-tête « PENDING > 24 h : N » (KPI K9, cible 0).
 *
 * Compté en base et non à partir des lignes affichées : le compteur doit rester
 * vrai même quand la liste est tronquée à `PENDING_PAYMENTS_LIMIT`. Le seuil
 * vient du domaine, pour que le chiffre affiché et la règle de la tâche
 * planifiée ne puissent pas diverger.
 */
export async function countStalePendingPayments(clock: PaymentsClock = {}): Promise<number> {
  const now = clock.now ?? new Date();
  const threshold = new Date(now.getTime() - STALE_PAYMENT_HOURS * 3_600_000);
  return prisma.payment.count({
    where: { status: "PENDING", createdAt: { lte: threshold } },
  });
}

/** Seuil affiché à l'écran (« au bout des tentatives ») — une seule source. */
export const MANUAL_REVIEW_ATTEMPTS = RECONCILE_MAX_ATTEMPTS;
