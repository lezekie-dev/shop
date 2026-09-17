import { NextResponse, type NextRequest } from "next/server";

import {
  CART_COOKIE_NAME,
  addToCart,
  getOrCreateCart,
  readCart,
  removeCartItem,
  updateCartItem,
  CartServerError,
} from "@/server/cart";
import { computeTotals } from "@/domain/cart";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────
// GET /api/cart
// ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  const { cart, created } = await getOrCreateCart({ cartCookieValue: cookieVal });
  const cartWithItems = await readCart(cart.id);
  if (!cartWithItems) {
    // Ne devrait pas arriver — getOrCreateCart vient de garantir l'existence
    return NextResponse.json({ error: "Cart introuvable" }, { status: 500 });
  }
  const totals = computeTotals(cartWithItems.items, 0);

  const res = NextResponse.json({
    id: cartWithItems.id,
    currency: cartWithItems.currency,
    items: cartWithItems.items.map((i) => ({
      variantId: i.variantId,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      productName: i.variant.product.name,
      variantName: i.variant.name,
      productSlug: i.variant.product.slug,
      lineTotalCents: i.quantity * i.unitPriceCents,
    })),
    totals,
    count: cartWithItems.items.reduce((acc, i) => acc + i.quantity, 0),
  });
  if (created) {
    setCartCookie(res, cartWithItems.id);
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/cart — ajouter une ligne
// ─────────────────────────────────────────────────────────────────────

type PostBody = { variantId: string; quantity: number };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await safeJson<PostBody>(req);
  if ("error" in body) return body.error;
  const { variantId, quantity } = body.value;
  if (!variantId || typeof variantId !== "string") {
    return NextResponse.json({ error: "variantId requis" }, { status: 400 });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity doit être > 0" }, { status: 400 });
  }

  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  const { cart, created } = await getOrCreateCart({ cartCookieValue: cookieVal });

  try {
    const updated = await addToCart(cart.id, variantId, quantity);
    const totals = computeTotals(updated.items, 0);
    const res = NextResponse.json({
      id: updated.id,
      items: updated.items.map(shapeItem),
      totals,
    });
    if (created) setCartCookie(res, updated.id);
    return res;
  } catch (err) {
    return mapCartError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// PATCH /api/cart — mettre à jour la quantité d'une ligne
// ─────────────────────────────────────────────────────────────────────

type PatchBody = { variantId: string; quantity: number };

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  if (!cookieVal) return NextResponse.json({ error: "Pas de panier" }, { status: 400 });

  const body = await safeJson<PatchBody>(req);
  if ("error" in body) return body.error;
  const { variantId, quantity } = body.value;
  if (!variantId) return NextResponse.json({ error: "variantId requis" }, { status: 400 });
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "quantity doit être > 0" }, { status: 400 });
  }

  try {
    const updated = await updateCartItem(cookieVal, variantId, quantity);
    const totals = computeTotals(updated.items, 0);
    return NextResponse.json({
      id: updated.id,
      items: updated.items.map(shapeItem),
      totals,
    });
  } catch (err) {
    return mapCartError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/cart — supprimer une ligne
// ─────────────────────────────────────────────────────────────────────

type DeleteBody = { variantId: string };

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  if (!cookieVal) return NextResponse.json({ error: "Pas de panier" }, { status: 400 });

  const body = await safeJson<DeleteBody>(req);
  if ("error" in body) return body.error;
  const { variantId } = body.value;
  if (!variantId) return NextResponse.json({ error: "variantId requis" }, { status: 400 });

  try {
    const updated = await removeCartItem(cookieVal, variantId);
    const totals = computeTotals(updated.items, 0);
    return NextResponse.json({
      id: updated.id,
      items: updated.items.map(shapeItem),
      totals,
    });
  } catch (err) {
    return mapCartError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function setCartCookie(res: NextResponse, cartId: string): void {
  res.cookies.set(CART_COOKIE_NAME, cartId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 jours
  });
}

type Item = {
  variantId: string;
  quantity: number;
  unitPriceCents: number;
  variant: {
    name: string;
    product: { name: string; slug: string };
  };
};

function shapeItem(i: Item) {
  return {
    variantId: i.variantId,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    productName: i.variant.product.name,
    variantName: i.variant.name,
    productSlug: i.variant.product.slug,
    lineTotalCents: i.quantity * i.unitPriceCents,
  };
}

async function safeJson<T>(req: NextRequest): Promise<{ value: T } | { error: NextResponse }> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Body JSON invalide" }, { status: 400 }) };
  }
  if (typeof payload !== "object" || payload === null) {
    return { error: NextResponse.json({ error: "Body doit être un objet" }, { status: 400 }) };
  }
  return { value: payload as T };
}

function mapCartError(err: unknown): NextResponse {
  if (err instanceof CartServerError) {
    const status =
      err.code === "OUT_OF_STOCK"
        ? 409
        : err.code === "CART_NOT_FOUND" || err.code === "VARIANT_NOT_FOUND"
          ? 404
          : err.code === "CART_CONVERTED"
            ? 410
            : 400;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error("[/api/cart] unexpected error", err);
  return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
}
