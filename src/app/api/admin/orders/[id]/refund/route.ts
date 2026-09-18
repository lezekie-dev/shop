import { NextResponse, type NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { selectPaymentProvider } from "@/domain/payment/registry";
import { PaymentError, refundOrder } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/[id]/refund
 *
 * Rembourse une commande payée. Le remboursement est initié chez le PSP
 * (`PaymentProvider.refund`) puis répercuté en base de façon transactionnelle
 * (`refundOrder`) : Order → REFUNDED, Payment → REFUNDED, stock ré-incrémenté.
 *
 * Deux natures de remboursement selon le provider, c'est le PSP qui tranche :
 *   - mock / mobile_money : `succeeded` immédiat → la commande passe REFUNDED
 *   - bank_transfer       : `pending` → le marchand fait le virement retour
 *     lui-même ; la commande passe REFUNDED quand même (l'intention est actée)
 *
 * Idempotent : rembourser une commande déjà REFUNDED renvoie 200 sans écriture.
 *
 * Body optionnel : { amountCents?: number, reason?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ error: "Authentification admin requise" }, { status: 401 });
  }

  // Body optionnel : un remboursement total se déclenche sans payload.
  let body: { amountCents?: unknown; reason?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Pas de body → remboursement total, c'est le cas nominal.
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) {
    return NextResponse.json({ error: `Commande introuvable: ${params.id}` }, { status: 404 });
  }

  const payment = order.payments[0];
  if (!payment) {
    return NextResponse.json(
      { error: "Aucun paiement enregistré pour cette commande", code: "PAYMENT_NOT_FOUND" },
      { status: 409 },
    );
  }

  const maxRefundable = payment.amountCents;
  const requested =
    typeof body.amountCents === "number" ? body.amountCents : maxRefundable;

  if (!Number.isInteger(requested) || requested <= 0) {
    return NextResponse.json(
      { error: "amountCents doit être un entier positif", code: "INVALID_AMOUNT" },
      { status: 400 },
    );
  }
  if (requested > maxRefundable) {
    return NextResponse.json(
      {
        error: `Le remboursement (${requested}) dépasse le montant encaissé (${maxRefundable})`,
        code: "AMOUNT_EXCEEDS_PAYMENT",
      },
      { status: 409 },
    );
  }

  const reason = typeof body.reason === "string" ? body.reason : null;

  try {
    // 1. Le PSP rembourse d'abord. Si ça jette, on n'écrit rien en base : la
    //    commande reste dans son état payé, cohérente avec le PSP.
    const provider = selectPaymentProvider(payment.provider);
    const refund = await provider.refund(
      payment.providerRef,
      requested === maxRefundable
        ? undefined
        : { amountCents: requested, currency: payment.currency },
    );

    // 2. Répercussion en base + stock.
    const result = await refundOrder(order.id, {
      amountCents: requested,
      providerRef: payment.providerRef,
      refundRef: refund.refundRef,
      reason,
    });

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "order.refund",
        entity: "Order",
        entityId: order.id,
        diff: {
          amountCents: requested,
          currency: payment.currency,
          provider: payment.provider,
          providerRef: payment.providerRef,
          refundRef: refund.refundRef,
          providerStatus: refund.status,
          reason,
          from: order.status,
          to: result.orderStatus,
        },
      },
    });

    return NextResponse.json({
      orderId: result.orderId,
      status: result.orderStatus,
      paymentStatus: result.paymentStatus,
      refundRef: refund.refundRef,
      providerStatus: refund.status,
      amountCents: requested,
      stockRestored: result.stockRestored,
      idempotent: result.idempotent,
    });
  } catch (err) {
    if (err instanceof PaymentError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("[/api/admin/orders/[id]/refund]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
