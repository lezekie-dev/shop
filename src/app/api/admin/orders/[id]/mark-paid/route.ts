import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { PaymentError, applyPaymentOutcome } from "@/server/payments";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/[id]/mark-paid
 *
 * Validation MANUELLE d'un virement bancaire : le marchand a vérifié son
 * compte et confirme l'encaissement. C'est le seul moyen de sortir une
 * commande `bank_transfer` de PENDING_PAYMENT (l'adaptateur virement n'a ni
 * API ni webhook).
 *
 * Effets : Order → PAID (paidAt), Payment → SUCCEEDED, décrément réel du
 * stock (via `applyPaymentOutcome`), + une ligne d'AuditLog.
 *
 * Protégé par la session admin (même vérification que `requireAdmin`).
 *
 * Capacité `orders:transition:paid` : confirmer un encaissement engage de
 * l'argent réel, donc ADMIN (CONVENTIONS §13). STAFF reçoit 403.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "orders:transition:paid");
  if (!access.ok) return access.response;
  const admin = access.user;

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) {
    return NextResponse.json({ error: `Commande introuvable: ${params.id}` }, { status: 404 });
  }

  if (order.paymentProvider !== "bank_transfer") {
    return NextResponse.json(
      {
        error:
          `mark-paid ne s'applique qu'aux virements bancaires. ` +
          `Cette commande utilise "${order.paymentProvider}" — sa confirmation ` +
          `vient du PSP, pas de l'admin.`,
        code: "NOT_BANK_TRANSFER",
      },
      { status: 409 },
    );
  }

  if (order.status === "PAID") {
    return NextResponse.json({
      orderId: order.id,
      status: "PAID",
      idempotent: true,
      message: "Commande déjà payée — aucune écriture.",
    });
  }

  if (order.status !== "PENDING_PAYMENT") {
    return NextResponse.json(
      {
        error: `Transition impossible : ${order.status} → PAID`,
        code: "INVALID_TRANSITION",
      },
      { status: 409 },
    );
  }

  const paymentRef = order.paymentRef ?? order.payments[0]?.providerRef ?? null;
  if (!paymentRef) {
    return NextResponse.json(
      { error: "Aucun paiement enregistré pour cette commande", code: "PAYMENT_NOT_FOUND" },
      { status: 409 },
    );
  }

  try {
    const result = await applyPaymentOutcome(order.id, paymentRef, "succeeded");

    await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "order.mark_paid",
        entity: "Order",
        entityId: order.id,
        diff: {
          paymentProvider: order.paymentProvider,
          paymentRef,
          from: order.status,
          to: result.orderStatus,
          paymentStatus: result.paymentStatus,
        },
      },
    });

    return NextResponse.json({
      orderId: result.orderId,
      status: result.orderStatus,
      paymentStatus: result.paymentStatus,
      idempotent: result.idempotent,
    });
  } catch (err) {
    if (err instanceof PaymentError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("[/api/admin/orders/[id]/mark-paid]", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
