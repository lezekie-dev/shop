import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireApiCapability } from "@/server/guards";
import { deleteProductImage, moveProductImage, updateProductImageAlt } from "@/server/product-images";

export const dynamic = "force-dynamic";

/**
 * PATCH  /api/admin/products/[id]/images/[imageId] — réordonner ou décrire.
 * DELETE /api/admin/products/[id]/images/[imageId] — supprimer (ligne + fichier).
 *
 * Capacité `products:write` (ADMIN) : STAFF ne gère pas le catalogue (§13).
 *
 * Une seule route pour les trois déplacements (`up`, `down`, `cover`) plutôt
 * que trois URL : c'est le MÊME geste métier « changer l'ordre », et trois
 * routes obligeraient l'UI à trois `fetch` différents pour deux boutons
 * fléchés. Le corps est une union discriminée, donc invalide en une passe.
 */

const bodySchema = z.discriminatedUnion("op", [
  // « Monter » / « Descendre » : échange avec le voisin immédiat.
  z.object({ op: z.literal("up") }),
  z.object({ op: z.literal("down") }),
  // « Définir comme photo principale » : passage en position 0, les autres
  // reculent d'un rang (sans trou).
  z.object({ op: z.literal("cover") }),
  // Édition de la description : elle reste obligatoire, donc non vide.
  z.object({ op: z.literal("alt"), alt: z.string().max(300) }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; imageId: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "products:write");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Action inconnue sur la photo", code: "ACTION_INVALIDE" },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const result =
    body.op === "alt"
      ? await updateProductImageAlt({
          productId: params.id,
          imageId: params.imageId,
          alt: body.alt,
          userId: access.user.id,
        })
      : await moveProductImage({
          productId: params.id,
          imageId: params.imageId,
          move: body.op,
          userId: access.user.id,
        });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ images: result.value });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; imageId: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "products:write");
  if (!access.ok) return access.response;

  const result = await deleteProductImage({
    productId: params.id,
    imageId: params.imageId,
    userId: access.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  return NextResponse.json({ images: result.value });
}
