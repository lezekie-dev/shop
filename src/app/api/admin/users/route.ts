import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { createAdminUser, listAdminUsers } from "@/server/admin-users";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/users — liste des utilisateurs internes (capacité `users:read`)
 * POST /api/admin/users — création d'un utilisateur (capacité `users:write`)
 *
 * Capacités réservées à ADMIN dans la matrice (CONVENTIONS §13) : STAFF reçoit
 * 403, et pas seulement un menu masqué — la vérification est ici, côté serveur,
 * parce qu'une URL d'API s'appelle sans passer par l'UI.
 *
 * Le DTO ne contient jamais `passwordHash` ni `totpSecret` (cf. `toSummary`).
 */

const createSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional().nullable(),
  role: z.enum(["ADMIN", "STAFF"]),
  // 10 caractères minimum : ce mot de passe protège un accès qui voit toutes
  // les commandes, donc les coordonnées de tous les clients. Plafond à 200 :
  // bcrypt ne prend en compte que les 72 PREMIERS octets, donc un mot de passe
  // de 10 000 caractères n'apporte aucune sécurité et coûte du CPU.
  password: z.string().min(10).max(200),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await requireApiCapability(req, "users:read");
  if (!access.ok) return access.response;

  const users = await listAdminUsers();
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await requireApiCapability(req, "users:write");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await createAdminUser({ actorId: access.user.id, input: parsed.data });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({ user: result.user }, { status: 201 });
}
