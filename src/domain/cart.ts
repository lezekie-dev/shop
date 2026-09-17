/**
 * Logique pure du panier (domaine) — aucune dépendance Next/Prisma.
 *
 * Le Cart est une **structure de données immuable** : chaque opération
 * (addItem / updateQty / removeItem) renvoie un nouveau Cart. Cela rend
 * les fonctions triviales à tester et à raisonner.
 *
 * Le stock n'est pas stocké dans le Cart — la fonction reçoit un
 * `availableStock` par appel, ce qui permet au code appelant (server)
 * d'aller le chercher en base à chaque mutation.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type CartItem = {
  variantId: string;
  quantity: number;
  unitPriceCents: number; // snapshot du prix au moment de l'ajout
};

export type CartItemInput = {
  variantId: string;
  unitPriceCents: number;
};

export type Cart = {
  items: CartItem[];
  currency: string; // ISO-4217, ex: "EUR"
};

// ─────────────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────────────

export class CartError extends Error {
  constructor(
    message: string,
    public readonly code: "OUT_OF_STOCK" | "INVALID_QUANTITY" | "VARIANT_NOT_FOUND",
  ) {
    super(message);
    this.name = "CartError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────────────────────────────

function findIndex(items: CartItem[], variantId: string): number {
  return items.findIndex((i) => i.variantId === variantId);
}

function assertPositiveQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new CartError(`Quantité invalide : ${qty}`, "INVALID_QUANTITY");
  }
}

function assertStockAvailable(desired: number, available: number): void {
  if (!Number.isInteger(available) || available < 0) {
    throw new CartError(`Stock invalide : ${available}`, "INVALID_QUANTITY");
  }
  if (desired > available) {
    throw new CartError(
      `Stock insuffisant : demandé ${desired}, disponible ${available}`,
      "OUT_OF_STOCK",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────

/**
 * Ajoute (ou agrège) une ligne au panier.
 *
 * @param cart              panier courant (non muté)
 * @param input             variantId + unitPriceCents (snapshot)
 * @param quantity          quantité à ajouter (entier > 0)
 * @param availableStock    stock total disponible pour ce variant
 */
export function addItem(
  cart: Cart,
  input: CartItemInput,
  quantity: number,
  availableStock: number,
): Cart {
  assertPositiveQty(quantity);

  const idx = findIndex(cart.items, input.variantId);
  const existingQty = idx >= 0 ? cart.items[idx]?.quantity ?? 0 : 0;
  const desiredTotal = existingQty + quantity;

  assertStockAvailable(desiredTotal, availableStock);

  if (idx >= 0) {
    const next = cart.items.slice();
    next[idx] = {
      variantId: input.variantId,
      quantity: desiredTotal,
      unitPriceCents: input.unitPriceCents,
    };
    return { ...cart, items: next };
  }

  return {
    ...cart,
    items: [
      ...cart.items,
      {
        variantId: input.variantId,
        quantity,
        unitPriceCents: input.unitPriceCents,
      },
    ],
  };
}

/**
 * Met à jour la quantité d'une ligne existante (entier strictement positif).
 * Ne fait rien (renvoie le même panier) si le variant n'est pas dans le panier.
 */
export function updateQty(
  cart: Cart,
  variantId: string,
  quantity: number,
  availableStock: number,
): Cart {
  assertPositiveQty(quantity);

  const idx = findIndex(cart.items, variantId);
  if (idx < 0) return cart;

  assertStockAvailable(quantity, availableStock);

  const next = cart.items.slice();
  const existing = cart.items[idx];
  if (!existing) return cart; // satisfait noUncheckedIndexedAccess
  next[idx] = { ...existing, quantity };
  return { ...cart, items: next };
}

/**
 * Supprime une ligne. Ne fait rien si le variant n'est pas présent.
 */
export function removeItem(cart: Cart, variantId: string): Cart {
  const idx = findIndex(cart.items, variantId);
  if (idx < 0) return cart;
  const next = cart.items.slice();
  next.splice(idx, 1);
  return { ...cart, items: next };
}

/**
 * Calcule les totaux à partir des items et d'un forfait livraison.
 * - subtotalCents = Σ quantity × unitPriceCents
 * - totalCents    = subtotal + shipping
 */
export function computeTotals(
  items: ReadonlyArray<CartItem>,
  shippingCents: number,
): { subtotalCents: number; shippingCents: number; totalCents: number } {
  const subtotalCents = items.reduce(
    (acc, i) => acc + i.quantity * i.unitPriceCents,
    0,
  );
  return {
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sérialisation (cookie / localStorage)
// ─────────────────────────────────────────────────────────────────────

const cartItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
});

const cartSchema = z.object({
  items: z.array(cartItemSchema),
  currency: z.string().min(1),
});

/** Sérialise un Cart en string JSON prête pour cookie/localStorage. */
export function serializeCart(cart: Cart): string {
  return JSON.stringify(cart);
}

/**
 * Désérialise une string JSON en Cart.
 * Renvoie un panier vide par défaut pour `{}`.
 * Jette CartError si le payload est mal formé.
 */
export function deserializeCart(raw: string): Cart {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CartError("Cart JSON invalide", "INVALID_QUANTITY");
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new CartError("Cart JSON invalide : pas un objet", "INVALID_QUANTITY");
  }
  const obj = parsed as Record<string, unknown>;
  // Tolère `{}` (objet vide) → panier vide par défaut
  if (Object.keys(obj).length === 0) {
    return { items: [], currency: "EUR" };
  }
  const result = cartSchema.safeParse(parsed);
  if (!result.success) {
    throw new CartError(
      `Cart JSON invalide : ${result.error.issues.map((i) => i.message).join(", ")}`,
      "INVALID_QUANTITY",
    );
  }
  return result.data;
}
