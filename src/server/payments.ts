/**
 * Transitions de paiement — UNE SEULE implémentation, partagée par :
 *   - le checkout (`POST /api/checkout`)              → méthode "mock"
 *   - le callback Mobile Money
 *     (`POST /api/payments/mobile-money/callback`)    → méthode "mobile_money"
 *   - la validation manuelle du virement bancaire
 *     (`POST /api/admin/orders/[id]/mark-paid`)        → méthode "bank_transfer"
 *
 * Sans ce point unique, les trois chemins divergeraient : c'est exactement le
 * genre de duplication qui produit des commandes payées sans décrément de
 * stock, ou un `Payment` SUCCEEDED sur une `Order` restée PENDING_PAYMENT.
 *
 * Invariants (cf. ADR-004 / ADR-005) :
 *   - "succeeded" : Order → PAID (paidAt), Payment → SUCCEEDED, et décrément
 *     réel du stock (`quantity -= reserved`, `reserved → 0`). Idempotent :
 *     rejouer un webhook sur une commande déjà PAID ne fait RIEN.
 *   - "pending"   : Payment → PENDING, Order reste PENDING_PAYMENT. Rejouer un
 *     "pending" APRÈS un succès ne rétrograde jamais (les webhooks arrivent
 *     dans le désordre).
 *   - "failed"    : Payment → FAILED, Order reste PENDING_PAYMENT (le marchand
 *     annule ou le client retente — on ne libère pas la réservation ici).
 *   - Tout est écrit dans une seule `prisma.$transaction`.
 */

import { Prisma, type OrderStatus, type PaymentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

export type PaymentOutcome = "succeeded" | "pending" | "failed";

export type PaymentErrorCode =
  | "ORDER_NOT_FOUND"
  | "PAYMENT_NOT_FOUND"
  | "INVALID_TRANSITION";

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: PaymentErrorCode,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export type PaymentOutcomeResult = {
  orderId: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  /** true = l'état était déjà celui demandé, aucune écriture faite. */
  idempotent: boolean;
};

/**
 * Applique un verdict de paiement à une commande.
 *
 * @param orderId     commande cible
 * @param paymentRef  `Payment.providerRef` visé ; `null` = dernier paiement
 *                    enregistré pour la commande
 * @param status      verdict du PSP (ou de l'admin pour un virement)
 */
export async function applyPaymentOutcome(
  orderId: string,
  paymentRef: string | null,
  status: PaymentOutcome,
): Promise<PaymentOutcomeResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) {
      throw new PaymentError(`Order introuvable: ${orderId}`, "ORDER_NOT_FOUND");
    }

    const payment = paymentRef
      ? order.payments.find((p) => p.providerRef === paymentRef)
      : order.payments[0];
    if (!payment) {
      throw new PaymentError(
        `Payment introuvable pour Order ${orderId} (providerRef=${paymentRef ?? "<dernier>"})`,
        "PAYMENT_NOT_FOUND",
      );
    }

    // ── Déjà payée : on ne touche à rien, quel que soit le verdict reçu ──
    if (order.status === "PAID") {
      if (payment.status !== "SUCCEEDED") {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "SUCCEEDED" },
        });
        return {
          orderId,
          orderStatus: "PAID" satisfies OrderStatus,
          paymentStatus: "SUCCEEDED" satisfies PaymentStatus,
          idempotent: true,
        };
      }
      return {
        orderId,
        orderStatus: order.status,
        paymentStatus: payment.status,
        idempotent: true,
      };
    }

    if (status === "succeeded") {
      if (order.status !== "PENDING_PAYMENT") {
        throw new PaymentError(
          `Order ${orderId} ne peut pas passer à PAID depuis ${order.status}`,
          "INVALID_TRANSITION",
        );
      }

      // Décrément final du stock : la marchandise réservée part réellement.
      for (const item of order.items) {
        const stock = await tx.stock.findUnique({ where: { variantId: item.variantId } });
        const reserved = stock?.reserved ?? 0;
        const quantity = stock?.quantity ?? 0;
        const reservedForThisItem = Math.min(reserved, item.quantity);
        await tx.stock.update({
          where: { variantId: item.variantId },
          data: {
            quantity: Math.max(0, quantity - reservedForThisItem),
            reserved: Math.max(0, reserved - reservedForThisItem),
          },
        });
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: "PAID", paidAt: new Date() },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "SUCCEEDED" },
      });

      return {
        orderId,
        orderStatus: "PAID" satisfies OrderStatus,
        paymentStatus: "SUCCEEDED" satisfies PaymentStatus,
        idempotent: false,
      };
    }

    if (status === "pending") {
      // Un "pending" tardif ne doit JAMAIS rétrograder un paiement confirmé.
      if (payment.status === "SUCCEEDED") {
        return {
          orderId,
          orderStatus: order.status,
          paymentStatus: payment.status,
          idempotent: true,
        };
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "PENDING" },
      });
      return {
        orderId,
        orderStatus: order.status,
        paymentStatus: "PENDING" satisfies PaymentStatus,
        idempotent: false,
      };
    }

    // status === "failed"
    if (payment.status === "SUCCEEDED") {
      return {
        orderId,
        orderStatus: order.status,
        paymentStatus: payment.status,
        idempotent: true,
      };
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    });
    return {
      orderId,
      orderStatus: order.status,
      paymentStatus: "FAILED" satisfies PaymentStatus,
      idempotent: false,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Idempotence des webhooks (ADR-005)
// ─────────────────────────────────────────────────────────────────────

export type ClaimedWebhook = {
  id: string;
  /** true = cet eventKey a DÉJÀ été traité → l'appelant doit répondre 200 sans rien rejouer. */
  duplicate: boolean;
};

/**
 * Réserve la première place pour `(provider, eventKey)`.
 * S'appuie sur la contrainte unique `WebhookEvent @@unique([provider, eventKey])`
 * plutôt que sur un `findUnique` puis `create` (race entre deux livraisons).
 */
export async function claimWebhookEvent(params: {
  provider: string;
  eventKey: string;
  type: string;
  payload: unknown;
}): Promise<ClaimedWebhook> {
  const payload = JSON.parse(JSON.stringify(params.payload)) as Prisma.InputJsonValue;

  // Chemin nominal d'un rejeu : la ligne existe déjà → aucun log d'erreur.
  const existing = await prisma.webhookEvent.findUnique({
    where: {
      provider_eventKey: { provider: params.provider, eventKey: params.eventKey },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, duplicate: true };

  try {
    const created = await prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        eventKey: params.eventKey,
        type: params.type,
        payload,
      },
      select: { id: true },
    });
    return { id: created.id, duplicate: false };
  } catch (err) {
    // Deux livraisons simultanées du même événement : la contrainte unique
    // tranche, on traite le perdant comme un doublon.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await prisma.webhookEvent.findUnique({
        where: {
          provider_eventKey: { provider: params.provider, eventKey: params.eventKey },
        },
        select: { id: true },
      });
      if (raced) return { id: raced.id, duplicate: true };
    }
    throw err;
  }
}

/** Note le résultat du traitement d'un webhook (audit + diagnostic). */
export async function markWebhookProcessed(id: string, error?: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      processedAt: new Date(),
      ...(error !== undefined ? { error } : {}),
    },
  });
}

/**
 * Libère une réservation de webhook quand le traitement a ÉCHOUÉ.
 *
 * Sans ça, un échec transitoire (DB indisponible) « consommerait » l'eventKey :
 * le PSP qui rejoue l'événement recevrait `duplicate: true` et le paiement
 * resterait PENDING pour toujours.
 */
export async function releaseClaimedWebhook(id: string): Promise<void> {
  await prisma.webhookEvent.delete({ where: { id } });
}

/** Résout la commande visée par une ref de paiement PSP. */
export async function findOrderIdByPaymentRef(
  provider: string,
  providerRef: string,
): Promise<string | null> {
  const payment = await prisma.payment.findUnique({
    where: { provider_providerRef: { provider, providerRef } },
    select: { orderId: true },
  });
  return payment?.orderId ?? null;
}
