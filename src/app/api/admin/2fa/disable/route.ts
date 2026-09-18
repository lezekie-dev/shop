import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { disableTotp } from "@/server/admin-2fa";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Code TOTP courant OU code de secours (dérivé du secret). */
  code: z.string().trim().min(1).max(64),
});

/**
 * POST /api/admin/2fa/disable — désactive la 2FA de l'utilisateur connecté.
 *
 * UN CODE VALIDE EST OBLIGATOIRE, la session ne suffit pas : le second facteur
 * doit résister au vol de session, sinon il ne sert à rien. C'est le code de
 * secours qui débloque l'utilisateur ayant perdu son téléphone.
 *
 * Efface `totpSecret` ET `totpEnabledAt` : un nouvel enrôlement générera un
 * secret neuf, donc l'ancien QR code imprimé ou photographié devient inutile.
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

  const result = await disableTotp({ userId: access.user.id, code: parsed.data.code });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({ enabled: false, method: result.method });
}
