import { NextResponse, type NextRequest } from "next/server";

import { requireCustomerApi } from "@/lib/customer-auth";
import { getCustomerOrderDetail } from "@/server/customer-orders";

export const dynamic = "force-dynamic";

/**
 * GET /api/account/orders/[id] — détail d'une commande du client connecté.
 *
 * L'id vient de l'URL, donc d'un tiers : la requête est TOUJOURS filtrée par le
 * `customerId` de la session. Une commande appartenant à quelqu'un d'autre est
 * renvoyée en 404 (`null` côté service) et non en 403 — un 403 confirmerait que
 * l'id existe.
 *
 * Le jeton `Order.accessToken` n'est pas accepté ici : cet endpoint est le
 * chemin « connecté ». Le suivi invité reste sur /api/orders/[id]?token=…,
 * inchangé.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const customer = await requireCustomerApi(req);
  if (!customer) {
    return NextResponse.json({ error: "Authentification client requise" }, { status: 401 });
  }

  const order = await getCustomerOrderDetail(customer.id, params.id);
  if (!order) {
    return NextResponse.json({ error: "Commande introuvable" }, { status: 404 });
  }

  return NextResponse.json(order);
}
