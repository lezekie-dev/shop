import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/[id]?token=<accessToken>
 *
 * Détail d'une commande, en LECTURE SEULE.
 *
 * Accès : le jeton `Order.accessToken` (256 bits) est obligatoire. L'id seul ne
 * suffit plus — avant cette correction, la route renvoyait email, téléphone et
 * adresse complète du client à quiconque connaissait l'URL. L'id technique
 * n'est pas un secret : il circule dans les logs admin, les exports et les
 * URLs de back-office.
 *
 * Un jeton invalide renvoie 404 (pas 403) : on ne confirme pas l'existence de
 * la commande à quelqu'un qui n'a pas le droit de la voir.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const orderId = ctx.params.id;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Jeton d'accès requis (paramètre ?token=)." },
      { status: 401 },
    );
  }

  // On cherche par (id, accessToken) : les deux doivent correspondre. Un jeton
  // valide sur une AUTRE commande ne donne donc rien.
  const order = await prisma.order.findFirst({
    where: { id: orderId, accessToken: token },
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
