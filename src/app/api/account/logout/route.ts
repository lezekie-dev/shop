import { NextResponse, type NextRequest } from "next/server";

import {
  clearCustomerCookieOnResponse,
  deleteCustomerSessionByToken,
  getCustomerSessionFromRequest,
} from "@/lib/customer-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/logout — ferme la session client.
 *
 * La ligne `CustomerSession` est SUPPRIMÉE, pas seulement le cookie : un jeton
 * qui ne serait plus transmis par le navigateur resterait sinon valable pour
 * toujours si quelqu'un l'avait copié (poste partagé, proxy, sauvegarde).
 *
 * 204 dans tous les cas, y compris sans session : se déconnecter deux fois
 * n'est pas une erreur, et répondre 401 ici ne ferait qu'informer un appelant
 * qu'il n'était pas connecté.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getCustomerSessionFromRequest(req);
  if (session) {
    await deleteCustomerSessionByToken(session.session.token);
  }

  const res = new NextResponse(null, { status: 204 });
  clearCustomerCookieOnResponse(res);
  return res;
}
