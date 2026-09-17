import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/[id] — lecture seule publique (par orderId suffit pour MVP).
 *
 * Renvoie un OrderDto minimal : id, number, status, totaux, items.
 * Pas d'auth en S2 (le partage du numéro de commande dans l'URL sert de
 * "secret" — voir ADR S4 sur l'espace client authentifié).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const orderId = ctx.params.id;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      customer: { select: { email: true, firstName: true, lastName: true, phone: true } },
      address: true,
      payments: { select: { status: true, provider: true, amountCents: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
  }
  return NextResponse.json({
    id: order.id,
    number: order.number,
    status: order.status,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: order.currency,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    customer: order.customer,
    address: order.address,
    items: order.items.map((i) => ({
      variantId: i.variantId,
      productName: i.productNameSnapshot,
      variantName: i.variantNameSnapshot,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      lineTotalCents: i.quantity * i.unitPriceCents,
    })),
    payments: order.payments,
  });
}
