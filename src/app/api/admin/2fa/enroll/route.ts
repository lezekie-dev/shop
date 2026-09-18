import { NextResponse, type NextRequest } from "next/server";

import { jsonFailure } from "@/lib/api-response";
import { startTotpEnrollment } from "@/server/admin-2fa";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/2fa/enroll — démarre l'enrôlement TOTP de l'utilisateur
 * CONNECTÉ (capacité `auth:login`, donc tout compte interne).
 *
 * POURQUOI AUCUN `userId` DANS LE BODY : chaque utilisateur n'enrôle que son
 * propre téléphone. Accepter un id en paramètre ouvrirait un IDOR — un STAFF
 * pourrait régénérer le secret d'un ADMIN et lire le QR code, donc fabriquer
 * les codes à sa place. L'identité vient de la session, jamais du client.
 *
 * La réponse contient le secret une seule fois par enrôlement : c'est à ce
 * moment que l'utilisateur le scanne (ou le recopie) dans son application.
 * Le secret n'est PAS journalisé dans AuditLog.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await requireApiCapability(req, "auth:login");
  if (!access.ok) return access.response;

  const result = await startTotpEnrollment({ userId: access.user.id });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({
    secret: result.secret,
    otpAuthUri: result.otpAuthUri,
    recoveryCode: result.recoveryCode,
    issuer: result.issuer,
  });
}
