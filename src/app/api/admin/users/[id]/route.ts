import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { getAdminUser, updateAdminUser } from "@/server/admin-users";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/[id] — modification d'un utilisateur interne
 * (capacité `users:write`, ADMIN uniquement).
 *
 * CE QUE CETTE ROUTE EMPÊCHE STRUCTURELLEMENT :
 *   - un STAFF ne peut pas l'atteindre (403 avant lecture du body), donc il ne
 *     peut ni se promouvoir ADMIN ni créer un complice ;
 *   - personne ne peut rétrograder ou désactiver le dernier administrateur
 *     actif (règle appliquée dans `updateAdminUser`, dans la transaction) ;
 *   - l'utilisateur ne peut pas être supprimé : il n'y a pas de handler DELETE,
 *     la désactivation est le seul chemin (`active: false`), ce qui préserve
 *     son historique d'audit.
 */

const patchSchema = z
  .object({
    name: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().email().max(200).optional(),
    role: z.enum(["ADMIN", "STAFF"]).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Aucun champ à mettre à jour",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "users:write");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await updateAdminUser({
    actorId: access.user.id,
    targetId: params.id,
    patch: parsed.data,
  });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({ user: result.user });
}

/** GET /api/admin/users/[id] — fiche d'un utilisateur (capacité `users:read`). */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "users:read");
  if (!access.ok) return access.response;

  const user = await getAdminUser(params.id);
  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

  return NextResponse.json({ user });
}
