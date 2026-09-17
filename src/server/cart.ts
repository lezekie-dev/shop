/**
 * Server layer — opérations sur le Cart, transactionnelles.
 *
 * Règles :
 *  - Le `cart_id` est un CUID2 stocké dans le cookie httpOnly `cart_id`.
 *    Le visiteur n'a pas besoin d'être identifié pour avoir un panier.
 *  - Toutes les écritures passent par des `prisma.$transaction` pour éviter
 *    les races sur la lecture/écriture du stock.
 *  - Les prix sont snapshotés dans `CartItem.unitPriceCents` au moment de
 *    l'ajout : si le prix de la variante change ensuite, le panier reste
 *    fidèle (c'est l'utilisateur qui voit l'écart potentiel au checkout).
 *  - Le calcul du total est **toujours refait côté serveur** — on ne fait
 *    jamais confiance à ce qu'envoie le client.
 */

import type { Cart, CartItem, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { newId } from "@/lib/ids";

export const CART_COOKIE_NAME = "cart_id";

export class CartServerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CART_NOT_FOUND"
      | "VARIANT_NOT_FOUND"
      | "OUT_OF_STOCK"
      | "INVALID_QUANTITY"
      | "CART_CONVERTED",
  ) {
    super(message);
    this.name = "CartServerError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// getOrCreateCart
// ─────────────────────────────────────────────────────────────────────

export type CreateCartOptions = {
  /** Valeur actuelle du cookie cart_id (peut être undefined pour nouveau visiteur) */
  cartCookieValue?: string | undefined;
  /** Optionnel : rattache le panier à un Customer déjà connu */
  customerId?: string | undefined;
  /** Devise du panier (défaut : "EUR") */
  currency?: string | undefined;
};

/**
 * Récupère un Cart ACTIVE existant ou en crée un nouveau.
 *
 * Si `cartCookieValue` pointe vers un Cart ACTIVE → on le réutilise.
 * Si le cartCookie pointe vers un Cart CONVERTED / ABANDONED ou inexistant
 *   → on crée un nouveau Cart et on renvoie son id (le caller posera le cookie).
 */
export async function getOrCreateCart(opts: CreateCartOptions = {}): Promise<{
  cart: Cart;
  created: boolean;
}> {
  const cookieValue = opts.cartCookieValue?.trim() || undefined;
  if (cookieValue) {
    const existing = await prisma.cart.findUnique({ where: { id: cookieValue } });
    if (existing && existing.status === "ACTIVE") {
      return { cart: existing, created: false };
    }
  }

  const created = await prisma.cart.create({
    data: {
      id: newId(),
      status: "ACTIVE",
      currency: opts.currency ?? "EUR",
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
    },
  });
  return { cart: created, created: true };
}

// ─────────────────────────────────────────────────────────────────────
// readCart
// ─────────────────────────────────────────────────────────────────────

export type CartWithItems = Cart & {
  items: Array<CartItem & { variant: { id: string; name: string; sku: string; product: { id: string; name: string; slug: string } } }>;
};

/**
 * Lit un Cart et ses items, avec les variants pour affichage.
 * Renvoie null si le cartId n'existe pas.
 */
export async function readCart(cartId: string): Promise<CartWithItems | null> {
  return prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              sku: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// addToCart
// ─────────────────────────────────────────────────────────────────────

/**
 * Ajoute (ou incrémente) une ligne du panier.
 * - Vérifie le stock disponible dans la même transaction.
 * - Snapshot le prix actuel de la variante dans CartItem.unitPriceCents
 *   à la création uniquement (un update garde le snapshot existant
 *   pour ne pas avantager le client si le prix baisse entretemps —
 *   le panier reste le contrat initial).
 *
 * Jette CartServerError avec code approprié si invalide.
 */
export async function addToCart(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<CartWithItems> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new CartServerError(
      `addToCart: quantity doit être > 0 (reçu ${quantity})`,
      "INVALID_QUANTITY",
    );
  }

  const cart = await prisma.cart.findUnique({ where: { id: cartId } });
  if (!cart) throw new CartServerError(`Cart introuvable: ${cartId}`, "CART_NOT_FOUND");
  if (cart.status !== "ACTIVE") {
    throw new CartServerError(
      `Cart ${cartId} n'est pas ACTIVE (status=${cart.status})`,
      "CART_CONVERTED",
    );
  }

  return prisma.$transaction(async (tx) => {
    const variant = await tx.variant.findUnique({
      where: { id: variantId },
      include: { stock: true, product: { select: { active: true } } },
    });
    if (!variant) {
      throw new CartServerError(`Variant introuvable: ${variantId}`, "VARIANT_NOT_FOUND");
    }
    if (!variant.active || !variant.product.active) {
      throw new CartServerError(`Variant inactif: ${variantId}`, "VARIANT_NOT_FOUND");
    }

    const stockQty = variant.stock?.quantity ?? 0;
    const stockReserved = variant.stock?.reserved ?? 0;
    const available = stockQty - stockReserved;

    const existingItem = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    const desiredTotal = (existingItem?.quantity ?? 0) + quantity;

    if (desiredTotal > available) {
      throw new CartServerError(
        `Stock insuffisant pour ${variantId}: demandé ${desiredTotal}, dispo ${available}`,
        "OUT_OF_STOCK",
      );
    }

    if (existingItem) {
      await tx.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: desiredTotal },
      });
    } else {
      await tx.cartItem.create({
        data: {
          cartId,
          variantId,
          quantity,
          unitPriceCents: variant.priceCents,
        },
      });
    }

    await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
    return readCartTx(tx, cartId);
  });
}

// ─────────────────────────────────────────────────────────────────────
// updateCartItem
// ─────────────────────────────────────────────────────────────────────

export async function updateCartItem(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<CartWithItems> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new CartServerError(
      `updateCartItem: quantity doit être > 0 (reçu ${quantity})`,
      "INVALID_QUANTITY",
    );
  }

  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new CartServerError(`Cart introuvable: ${cartId}`, "CART_NOT_FOUND");
    if (cart.status !== "ACTIVE") {
      throw new CartServerError(
        `Cart ${cartId} n'est pas ACTIVE (status=${cart.status})`,
        "CART_CONVERTED",
      );
    }

    const item = await tx.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    if (!item) {
      throw new CartServerError(`Ligne introuvable: ${variantId}`, "VARIANT_NOT_FOUND");
    }

    const stock = await tx.stock.findUnique({ where: { variantId } });
    const available = (stock?.quantity ?? 0) - (stock?.reserved ?? 0);
    if (quantity > available) {
      throw new CartServerError(
        `Stock insuffisant pour ${variantId}: demandé ${quantity}, dispo ${available}`,
        "OUT_OF_STOCK",
      );
    }

    await tx.cartItem.update({
      where: { id: item.id },
      data: { quantity },
    });
    await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
    return readCartTx(tx, cartId);
  });
}

// ─────────────────────────────────────────────────────────────────────
// removeCartItem
// ─────────────────────────────────────────────────────────────────────

export async function removeCartItem(
  cartId: string,
  variantId: string,
): Promise<CartWithItems> {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw new CartServerError(`Cart introuvable: ${cartId}`, "CART_NOT_FOUND");
    if (cart.status !== "ACTIVE") {
      throw new CartServerError(
        `Cart ${cartId} n'est pas ACTIVE (status=${cart.status})`,
        "CART_CONVERTED",
      );
    }
    await tx.cartItem.deleteMany({ where: { cartId, variantId } });
    await tx.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
    return readCartTx(tx, cartId);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers privés
// ─────────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

async function readCartTx(tx: Tx, cartId: string): Promise<CartWithItems> {
  const found = await tx.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              name: true,
              sku: true,
              product: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!found) throw new CartServerError(`Cart introuvable: ${cartId}`, "CART_NOT_FOUND");
  return found;
}
