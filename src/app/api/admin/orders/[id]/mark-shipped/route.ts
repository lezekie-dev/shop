import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { canTransitionTo } from "@/domain/order";
import { requireAdminApi } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendOrderShipped } from "@/server/email";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  carrier: z.string().min(1).max(80).default("Transporteur démo"),
  trackingNo: z.string().min(1).max(80).optional(),
});

/**
 * POST /api/admin/orders/[id]/mark-shipped
 *
 * Action admin « marquer expédiée » : crée l'expédition, passe la commande en
 * SHIPPED et déclenche l'email d'expédition (transporteur + numéro de suivi).
 *
 * Transitions acceptées : PAID → SHIPPED (raccourci admin, sans étape de
 * préparation explicite) ou PREPARING → SHIPPED (chemin nominal du domaine).
 * Protégé par la session admin (même vérification que `requireAdmin`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ error: "Authentification admin requise" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json().catch(() => ({}));
  } catch {
    payload = {};
  }
  const parsed = bodySchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) {
    return NextResponse.json({ error: `Commande introuvable: ${params.id}` }, { status: 404 });
  }

  if (order.status === "SHIPPED" || order.status === "DELIVERED") {
    return NextResponse.json({
      orderId: order.id,
      status: order.status,
      idempotent: true,
      message: "Commande déjà expédiée — aucune écriture.",
    });
  }

  const allowed = canTransitionTo(order.status, "SHIPPED") || order.status === "PAID";
  if (!allowed) {
    return NextResponse.json(
      {
        error: `Transition impossible : ${order.status} → SHIPPED (expédier une commande payée ou en préparation)`,
        code: "INVALID_TRANSITION",
      },
      { status: 409 },
    );
  }

  const { carrier, trackingNo } = parsed.data;
  // Un numéro de suivi est généré si l'admin n'en fournit pas : les emails et
  // la page de suivi ne doivent jamais afficher un champ vide.
  const effectiveTracking = trackingNo ?? `DEMO-${order.number.replace(/\D/g, "")}`;
  const now = new Date();

  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.shipment.create({
      data: {
        orderId: order.id,
        carrier,
        trackingNo: effectiveTracking,
        status: "IN_TRANSIT",
        shippedAt: now,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: "SHIPPED", shippedAt: now },
    });
    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: "order.mark_shipped",
        entity: "Order",
        entityId: order.id,
        diff: {
          from: order.status,
          to: "SHIPPED",
          carrier,
          trackingNo: effectiveTracking,
          shipmentId: created.id,
        },
      },
    });
    return created;
  });

  // Hors transaction : l'email ne doit jamais faire échouer l'expédition.
  await sendOrderShipped(order.id, { carrier, trackingNo: effectiveTracking });

  return NextResponse.json({
    orderId: order.id,
    status: "SHIPPED",
    shipmentId: shipment.id,
    carrier,
    trackingNo: effectiveTracking,
  });
}
