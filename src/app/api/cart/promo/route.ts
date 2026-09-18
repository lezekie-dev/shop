import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { CART_COOKIE_NAME, getOrCreateCart } from "@/server/cart";
import { PromoError, applyPromoCodeToCart, clearPromoCodeFromCart } from "@/server/promo";

export const dynamic = "force-dynamic";

/**
 * Saisie du code promo dans le panier (chantier E, user story E2).
 *
 * ─── POURQUOI UN REFUS RÉPOND 200 ET NON 400 ────────────────────────────
 * « Ce code a expiré » n'est pas une requête mal formée : c'est une réponse
 * MÉTIER à une saisie valide. La distinguer d'une erreur technique (400 =
 * corps illisible) évite que l'interface affiche « erreur » là où elle doit
 * afficher « il manque 12,50 € ». Le motif voyage dans `reason` (stable, pour
 * le code) ET dans `message` (phrase actionnable, pour l'humain).
 *
 * ─── CE QUE LA ROUTE N'ACCEPTE PAS ──────────────────────────────────────
 * Aucun montant. Le seul champ accepté est `code` : le serveur lit le
 * sous-total en base et calcule la remise lui-même. Accepter un
 * `discountCents` ici ouvrirait exactement la faille que le PO veut fermer
 * (risque R4 : le client décide de sa remise).
 */

const bodySchema = z.object({
  code: z.string().trim().min(1, "Saisissez un code.").max(64),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  const { cart } = await getOrCreateCart({ cartCookieValue: cookieVal });

  try {
    const result = await applyPromoCodeToCart({ cartId: cart.id, rawCode: parsed.data.code });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PromoError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("[/api/cart/promo] unexpected error", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}

/**
 * Retrait du code : `Cart.promoCode` repasse à `null` et la remise à 0, donc le
 * total revient exactement à ce qu'il était avant la saisie (AC E2).
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  if (!cookieVal) {
    return NextResponse.json({ error: "Pas de panier actif" }, { status: 400 });
  }

  const { cart } = await getOrCreateCart({ cartCookieValue: cookieVal });
  const cleared = await clearPromoCodeFromCart(cart.id);
  return NextResponse.json({ applied: false, ...cleared });
}
