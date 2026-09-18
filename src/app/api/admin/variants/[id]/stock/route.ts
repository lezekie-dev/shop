import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminApi } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/variants/[id]/stock
 *
 * Édition du stock réel d'une variante (`quantity`), et éventuellement du
 * réservé (`reserved`). Le stock est créé s'il n'existe pas encore : une variante
 * fraîchement ajoutée n'a aucune ligne `Stock`.
 *
 * Invariant vérifié ici : `reserved <= quantity`. Une réservation supérieure au
 * stock signifierait qu'on a promis plus de marchandise qu'on n'en possède —
 * exactement ce que l'ADR-004 interdit. On refuse en 400 avec un message clair
 * plutôt que de laisser la base dans un état incohérent.
 *
 * Chaque écriture produit une ligne d'AuditLog (avant/après).
 */

const MAX_UNITS = 1_000_000;

const bodySchema = z.object({
  quantity: z.number().int().min(0).max(MAX_UNITS),
  reserved: z.number().int().min(0).max(MAX_UNITS).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ error: "Authentification admin requise" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const variant = await prisma.variant.findUnique({
    where: { id: params.id },
    include: { stock: true },
  });
  if (!variant) {
    return NextResponse.json({ error: `Variante introuvable: ${params.id}` }, { status: 404 });
  }

  const { quantity } = parsed.data;
  const reserved = parsed.data.reserved ?? variant.stock?.reserved ?? 0;

  if (reserved > quantity) {
    return NextResponse.json(
      {
        error:
          `Incohérence : ${reserved} unité(s) réservée(s) pour ${quantity} en stock. ` +
          "Le réservé ne peut pas dépasser le stock réel.",
        code: "RESERVED_EXCEEDS_QUANTITY",
      },
      { status: 400 },
    );
  }

  const before = {
    quantity: variant.stock?.quantity ?? null,
    reserved: variant.stock?.reserved ?? null,
  };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const stock = await tx.stock.upsert({
        where: { variantId: variant.id },
        update: { quantity, reserved },
        create: { variantId: variant.id, quantity, reserved },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "stock.update",
          entity: "Variant",
          entityId: variant.id,
          diff: {
            sku: variant.sku,
            before,
            after: { quantity: stock.quantity, reserved: stock.reserved },
          },
        },
      });

      return stock;
    });

    return NextResponse.json({
      stock: {
        variantId: updated.variantId,
        quantity: updated.quantity,
        reserved: updated.reserved,
        available: updated.quantity - updated.reserved,
      },
    });
  } catch (err) {
    console.error("[/api/admin/variants/[id]/stock PATCH]", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
