import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST as checkout } from "@/app/api/checkout/route";
import { GET as orderGet } from "@/app/api/orders/[id]/route";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";
import { CART_COOKIE_NAME, getOrCreateCart } from "@/server/cart";

function checkoutRequest(cartCookieValue: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${CART_COOKIE_NAME}=${cartCookieValue}`,
    },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  email: "buyer@shop.local",
  firstName: "Aïcha",
  lastName: "Dupont",
  phone: "+33600000000",
  address: {
    line1: "12 rue des Lilas",
    city: "Douala",
    postalCode: "00237",
    country: "FR",
  },
  billingAddressSame: true,
  paymentMethod: "mock" as const,
};

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

describe("POST /api/checkout (mock payment)", () => {
  it("commande payante : Order PAID, items créés, stock.quantity décrémenté, reserved=0, Cart CONVERTED", async () => {
    const { products } = await seedFixtures();
    const v1 = products["t-shirt-basique-blanc"]!.variants[0]!;
    const v2 = products["sac-tote-canvas"]!.variants[0]!;

    // Prépare un Cart ACTIVE avec 2 articles
    const { cart } = await getOrCreateCart({});
    await prismaTest.cartItem.create({
      data: { cartId: cart.id, variantId: v1.id, quantity: 2, unitPriceCents: v1.priceCents },
    });
    await prismaTest.cartItem.create({
      data: { cartId: cart.id, variantId: v2.id, quantity: 1, unitPriceCents: v2.priceCents },
    });

    // Snapshot stocks avant
    const stockV1Before = await prismaTest.stock.findUniqueOrThrow({ where: { variantId: v1.id } });
    const stockV2Before = await prismaTest.stock.findUniqueOrThrow({ where: { variantId: v2.id } });

    const res = await checkout(checkoutRequest(cart.id, baseBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.orderId).toBeTruthy();
    expect(data.orderNumber).toMatch(/^ORD-\d{4}-\d{6}$/);
    // 2 * 1990 + 1 * 1490 + 590 (shipping) = 6060
    expect(data.totalCents).toBe(6060);

    // Order status = PAID
    const order = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { items: true, payments: true },
    });
    expect(order.status).toBe("PAID");
    expect(order.paidAt).toBeTruthy();
    expect(order.subtotalCents).toBe(2 * 1990 + 1 * 1490);
    expect(order.shippingCents).toBe(590);
    expect(order.currency).toBe("EUR");
    expect(order.items).toHaveLength(2);
    // OrderItem snapshots
    for (const i of order.items) {
      expect(i.productNameSnapshot.length).toBeGreaterThan(0);
      expect(i.variantNameSnapshot.length).toBeGreaterThan(0);
    }

    // Payment = SUCCEEDED
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]?.status).toBe("SUCCEEDED");
    expect(order.payments[0]?.provider).toBe("mock");
    expect(order.payments[0]?.providerRef).toMatch(/^mock_/);

    // Cart = CONVERTED
    const cartAfter = await prismaTest.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(cartAfter.status).toBe("CONVERTED");

    // Stock décrémenté : quantity -= reserved (== quantity achat), reserved -> 0
    const stockV1After = await prismaTest.stock.findUniqueOrThrow({ where: { variantId: v1.id } });
    expect(stockV1After.quantity).toBe(stockV1Before.quantity - 2);
    expect(stockV1After.reserved).toBe(0);

    const stockV2After = await prismaTest.stock.findUniqueOrThrow({ where: { variantId: v2.id } });
    expect(stockV2After.quantity).toBe(stockV2Before.quantity - 1);
    expect(stockV2After.reserved).toBe(0);

    // Customer créé, address créée
    const customer = await prismaTest.customer.findUniqueOrThrow({
      where: { email: "buyer@shop.local" },
      include: { addresses: true },
    });
    expect(customer.firstName).toBe("Aïcha");
    expect(customer.lastName).toBe("Dupont");
    expect(customer.addresses).toHaveLength(1);
    expect(order.addressId).toBe(customer.addresses[0]!.id);
  });

  it("rejette un checkout sur panier vide", async () => {
    await seedFixtures();
    const { cart } = await getOrCreateCart({});
    const res = await checkout(checkoutRequest(cart.id, baseBody));
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.code).toBe("CART_EMPTY");
  });

  it("rejette un body invalide (email manquant)", async () => {
    await seedFixtures();
    const { cart } = await getOrCreateCart({});
    const res = await checkout(
      checkoutRequest(cart.id, { ...baseBody, email: "not-an-email" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejette si le panier n'existe pas (cookie inconnu)", async () => {
    await seedFixtures();
    const res = await checkout(checkoutRequest("does-not-exist-id", baseBody));
    // Pas de cookie / cookie inconnu : getOrCreateCart crée un cart vide, mais
    // l'API renvoie 400 (pas de panier actif fourni) — soit 410 si on crée.
    // Le comportement actuel est : cookie absent → 400 ; cookie inconnu → crée + 410 CART_EMPTY
    expect([400, 410]).toContain(res.status);
  });

  it("GET /api/orders/[id] exige le jeton d'accès (401 sans, 200 avec)", async () => {
    const { products } = await seedFixtures();
    const v = products["t-shirt-basique-blanc"]!.variants[0]!;
    const { cart } = await getOrCreateCart({});
    await prismaTest.cartItem.create({
      data: { cartId: cart.id, variantId: v.id, quantity: 1, unitPriceCents: v.priceCents },
    });
    const res = await checkout(checkoutRequest(cart.id, baseBody));
    const { orderId, accessToken } = await res.json();
    expect(accessToken, "le checkout doit renvoyer le jeton d'accès").toMatch(/^[0-9a-f]{64}$/);

    // Sans jeton : 401. L'id seul ne doit plus rien ouvrir — c'était la faille
    // (email, téléphone et adresse du client exposés à qui avait l'URL).
    const withoutToken = await orderGet(
      new NextRequest(`http://localhost:3000/api/orders/${orderId}`),
      { params: { id: orderId } },
    );
    expect(withoutToken.status).toBe(401);

    // Avec un jeton invalide : 404 (on ne confirme pas l'existence).
    const wrongToken = await orderGet(
      new NextRequest(`http://localhost:3000/api/orders/${orderId}?token=${"0".repeat(64)}`),
      { params: { id: orderId } },
    );
    expect(wrongToken.status).toBe(404);

    // Avec le bon jeton : 200 et le détail complet.
    const getRes = await orderGet(
      new NextRequest(`http://localhost:3000/api/orders/${orderId}?token=${accessToken}`),
      { params: { id: orderId } },
    );
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data.id).toBe(orderId);
    expect(data.status).toBe("PAID");
    expect(data.items).toHaveLength(1);
  });
});
