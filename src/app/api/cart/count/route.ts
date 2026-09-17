import { NextResponse, type NextRequest } from "next/server";

import { CART_COOKIE_NAME, readCart } from "@/server/cart";

export const dynamic = "force-dynamic";

/**
 * GET /api/cart/count — renvoie le nombre total d'unités dans le panier.
 * Utilisé par le badge UI dans le header.
 *
 * Si pas de cookie → renvoie { count: 0 } SANS créer de panier (lazy : le panier
 * n'est créé que lorsqu'on ajoute un article, pas au simple affichage du badge).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  if (!cookieVal) {
    return NextResponse.json({ count: 0 });
  }
  const cart = await readCart(cookieVal);
  if (!cart || cart.status !== "ACTIVE") {
    return NextResponse.json({ count: 0 });
  }
  const count = cart.items.reduce((acc, i) => acc + i.quantity, 0);
  return NextResponse.json({ count });
}
