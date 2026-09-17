import { describe, expect, it } from "vitest";
import {
  addItem,
  updateQty,
  removeItem,
  computeTotals,
  serializeCart,
  deserializeCart,
  type Cart,
  type CartItem,
  type CartItemInput,
} from "@/domain/cart";

const variantA = { variantId: "var_a", unitPriceCents: 1990 };
const variantB = { variantId: "var_b", unitPriceCents: 590 };

function emptyCart(): Cart {
  return { items: [], currency: "EUR" };
}

describe("addItem", () => {
  it("ajoute une nouvelle ligne au panier vide", () => {
    const cart = addItem(emptyCart(), variantA, 2, 10);
    expect(cart.items).toEqual<CartItem[]>([
      { variantId: "var_a", quantity: 2, unitPriceCents: 1990 },
    ]);
  });

  it("agrège la quantité quand le variantId existe déjà", () => {
    const c1 = addItem(emptyCart(), variantA, 2, 10);
    const c2 = addItem(c1, variantA, 3, 10);
    expect(c2.items).toHaveLength(1);
    expect(c2.items[0]?.quantity).toBe(5);
  });

  it("rejette une quantité > stock disponible", () => {
    expect(() => addItem(emptyCart(), variantA, 11, 10)).toThrow(/stock/i);
    // Le panier reste inchangé après l'échec (immutabilité)
    expect(emptyCart().items).toEqual([]);
  });

  it("rejette une quantité <= 0", () => {
    expect(() => addItem(emptyCart(), variantA, 0, 10)).toThrow();
    expect(() => addItem(emptyCart(), variantA, -1, 10)).toThrow();
  });

  it("ne mélange pas deux variants différents", () => {
    const c = addItem(addItem(emptyCart(), variantA, 1, 10), variantB, 2, 10);
    expect(c.items).toHaveLength(2);
    const byId = new Map(c.items.map((i) => [i.variantId, i]));
    expect(byId.get("var_a")?.quantity).toBe(1);
    expect(byId.get("var_b")?.quantity).toBe(2);
  });

  it("préserve la disponibilité réelle : si on a déjà 3 unités d'un stock de 5, on peut en ajouter 2 max", () => {
    const c1 = addItem(emptyCart(), variantA, 3, 5);
    expect(() => addItem(c1, variantA, 3, 5)).toThrow(/stock/i);
    const c2 = addItem(c1, variantA, 2, 5);
    expect(c2.items[0]?.quantity).toBe(5);
  });
});

describe("updateQty", () => {
  it("met à jour la quantité d'une ligne existante", () => {
    const c1 = addItem(emptyCart(), variantA, 2, 10);
    const c2 = updateQty(c1, "var_a", 7, 10);
    expect(c2.items[0]?.quantity).toBe(7);
  });

  it("rejette une quantité <= 0 (implicite : utiliser removeItem)", () => {
    const c1 = addItem(emptyCart(), variantA, 2, 10);
    expect(() => updateQty(c1, "var_a", 0, 10)).toThrow();
    expect(() => updateQty(c1, "var_a", -3, 10)).toThrow();
  });

  it("rejette une quantité > stock disponible", () => {
    const c1 = addItem(emptyCart(), variantA, 2, 10);
    expect(() => updateQty(c1, "var_a", 11, 10)).toThrow(/stock/i);
  });

  it("laisse le panier inchangé si le variant n'existe pas", () => {
    const c1 = addItem(emptyCart(), variantA, 2, 10);
    const c2 = updateQty(c1, "var_b", 5, 10);
    expect(c2.items).toEqual(c1.items);
  });

  it("ne modifie pas l'objet d'origine (immutabilité)", () => {
    const c1 = addItem(emptyCart(), variantA, 2, 10);
    const c2 = updateQty(c1, "var_a", 5, 10);
    expect(c1.items[0]?.quantity).toBe(2);
    expect(c2.items[0]?.quantity).toBe(5);
  });
});

describe("removeItem", () => {
  it("supprime la ligne correspondante", () => {
    const c1 = addItem(addItem(emptyCart(), variantA, 1, 10), variantB, 2, 10);
    const c2 = removeItem(c1, "var_a");
    expect(c2.items).toHaveLength(1);
    expect(c2.items[0]?.variantId).toBe("var_b");
  });

  it("ne fait rien si le variant n'est pas présent", () => {
    const c1 = addItem(emptyCart(), variantA, 1, 10);
    const c2 = removeItem(c1, "var_b");
    expect(c2.items).toHaveLength(1);
  });

  it("laisse un panier vide après suppression de la dernière ligne", () => {
    const c1 = addItem(emptyCart(), variantA, 1, 10);
    const c2 = removeItem(c1, "var_a");
    expect(c2.items).toEqual([]);
  });
});

describe("computeTotals", () => {
  it("calcule subtotal + shipping + total pour un panier non vide", () => {
    const items: CartItem[] = [
      { variantId: "v1", quantity: 2, unitPriceCents: 1990 }, // 3980
      { variantId: "v2", quantity: 1, unitPriceCents: 590 }, // 590
    ];
    expect(computeTotals(items, 590)).toEqual({
      subtotalCents: 4570,
      shippingCents: 590,
      totalCents: 5160,
    });
  });

  it("calcule un panier vide (tout à 0)", () => {
    expect(computeTotals([], 590)).toEqual({
      subtotalCents: 0,
      shippingCents: 590,
      totalCents: 590,
    });
  });

  it("shippingCents = 0 est autorisé (livraison offerte)", () => {
    const items: CartItem[] = [{ variantId: "v1", quantity: 1, unitPriceCents: 5000 }];
    expect(computeTotals(items, 0)).toEqual({
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
    });
  });

  it("ne mute pas l'input items", () => {
    const items: CartItem[] = [{ variantId: "v1", quantity: 2, unitPriceCents: 1990 }];
    const snapshot = JSON.stringify(items);
    computeTotals(items, 590);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe("serialize / deserialize", () => {
  it("sérialise un panier en string JSON", () => {
    const cart: Cart = {
      items: [{ variantId: "v1", quantity: 2, unitPriceCents: 1990 }],
      currency: "EUR",
    };
    const str = serializeCart(cart);
    expect(typeof str).toBe("string");
    expect(JSON.parse(str)).toEqual(cart);
  });

  it("désérialise une string JSON en Cart", () => {
    const str = JSON.stringify({
      items: [{ variantId: "v1", quantity: 2, unitPriceCents: 1990 }],
      currency: "EUR",
    });
    expect(deserializeCart(str)).toEqual<Cart>({
      items: [{ variantId: "v1", quantity: 2, unitPriceCents: 1990 }],
      currency: "EUR",
    });
  });

  it("désérialise un panier vide (string '{}') en panier vide par défaut", () => {
    expect(deserializeCart("{}")).toEqual<Cart>({ items: [], currency: "EUR" });
  });

  it("rejette un payload mal formé", () => {
    expect(() => deserializeCart("not json")).toThrow();
    expect(() => deserializeCart(JSON.stringify({ items: "bad" }))).toThrow();
    expect(() =>
      deserializeCart(JSON.stringify({ items: [{ variantId: "v", quantity: 0, unitPriceCents: 0 }] })),
    ).toThrow();
  });

  it("round-trip : serialize(deserialize(x)) === x", () => {
    const original: Cart = {
      items: [
        { variantId: "v1", quantity: 3, unitPriceCents: 1990 },
        { variantId: "v2", quantity: 1, unitPriceCents: 590 },
      ],
      currency: "EUR",
    };
    expect(deserializeCart(serializeCart(original))).toEqual(original);
  });
});

describe("types utilitaires", () => {
  it("CartItemInput expose variantId et unitPriceCents", () => {
    const input: CartItemInput = { variantId: "v1", unitPriceCents: 100 };
    expect(input.variantId).toBe("v1");
  });
});
