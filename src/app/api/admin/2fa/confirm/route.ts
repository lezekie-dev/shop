import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { confirmTotpEnrollment } from "@/server/admin-2fa";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // Le code TOTP fait 6 chiffres ; on accepte large (l'app d'authentification
  // peut afficher des espaces) car la validation fine est cryptographique.
  code: z.string().trim().min(1).max(64),
});

/**
 * POST /api/admin/2fa/confirm — valide le PREMIER code et active la 2FA.
 *
 * C'est cette route, et non le scan du QR code, qui renseigne `totpEnabledAt`.
 * Tant qu'elle n'a pas répondu 200, la 2FA est inerte et la connexion reste
 * possible avec le seul mot de passe : un enrôlement abandonné (QR scanné puis
 * onglet fermé) ne peut donc pas enfermer l'utilisateur hors de son compte.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await requireApiCapability(req, "auth:login");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Code requis" }, { status: 400 });
  }

  const result = await confirmTotpEnrollment({ userId: access.user.id, code: parsed.data.code });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({ enabled: true, enabledAt: result.enabledAt.toISOString() });
}
