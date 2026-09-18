import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { requireAdminApi } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/products/[id]
 *
 * Édition partielle d'un produit : nom, slug, description, catégorie et statut
 * actif/inactif. Toute modification écrit une ligne d'AuditLog (qui a changé
 * quoi, avant/après) : c'est la trace exigée par la story F2.
 *
 * Un `active: false` n'est PAS une suppression : les commandes passées gardent
 * leurs snapshots, donc désactiver un produit ne casse aucun historique.
 */

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(slugPattern, "slug invalide (minuscules, chiffres et tirets)")
      .optional(),
    description: z.string().trim().min(1).max(5_000).optional(),
    categoryId: z.string().min(1).max(64).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Aucun champ à mettre à jour",
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
  const data = parsed.data;

  const existing = await prisma.product.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: `Produit introuvable: ${params.id}` }, { status: 404 });
  }

  if (data.categoryId !== undefined) {
    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json(
        { error: `Catégorie introuvable: ${data.categoryId}`, code: "CATEGORY_NOT_FOUND" },
        { status: 400 },
      );
    }
  }

  const before = {
    name: existing.name,
    slug: existing.slug,
    description: existing.description,
    categoryId: existing.categoryId,
    active: existing.active,
  };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id: params.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.slug !== undefined ? { slug: data.slug } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: "product.update",
          entity: "Product",
          entityId: product.id,
          diff: {
            before,
            after: {
              name: product.name,
              slug: product.slug,
              description: product.description,
              categoryId: product.categoryId,
              active: product.active,
            },
            changed: Object.keys(data),
          },
        },
      });

      return product;
    });

    return NextResponse.json({
      product: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
        description: updated.description,
        categoryId: updated.categoryId,
        active: updated.active,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Ce slug est déjà utilisé par un autre produit", code: "SLUG_TAKEN" },
        { status: 409 },
      );
    }
    console.error("[/api/admin/products/[id] PATCH]", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
