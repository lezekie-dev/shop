import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST as checkout } from "@/app/api/checkout/route";
import { POST as mmCallback } from "@/app/api/payments/mobile-money/callback/route";
import { POST as markPaid } from "@/app/api/admin/orders/[id]/mark-paid/route";
import { GET as providersGet } from "@/app/api/payments/providers/route";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";
import { CART_COOKIE_NAME, getOrCreateCart } from "@/server/cart";
import { newId } from "@/lib/ids";

const SHIPPING_CENTS = 590;
const TSHIRT_PRICE = 1990;

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

function callbackRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/payments/mobile-money/callback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mock-signature": "t=demo,v1=simulated",
    },
    body: JSON.stringify(body),
  });
}

function markPaidRequest(orderId: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}/mark-paid`, {
    method: "POST",
    headers: token ? { cookie: `admin_session=${token}` } : {},
  });
}

const customer = {
  email: "buyer@shop.local",
  firstName: "Aïcha",
  lastName: "Dupont",
  phone: "+237600000001",
  address: { line1: "12 rue des Lilas", city: "Douala", postalCode: "00237", country: "FR" },
  billingAddressSame: true,
};

/** Panier ACTIVE avec 1 ligne du t-shirt blanc (prix 1990). */
async function cartWithTshirt(quantity = 1) {
  const { products } = await seedFixtures();
  const variant = products["t-shirt-basique-blanc"]!.variants[0]!;
  const { cart } = await getOrCreateCart({});
  await prismaTest.cartItem.create({
    data: {
      cartId: cart.id,
      variantId: variant.id,
      quantity,
      unitPriceCents: variant.priceCents,
    },
  });
  return { cart, variant };
}

/** Session admin valide (cookie `admin_session`). */
async function adminToken(): Promise<string> {
  // ⚠ On ne rappelle PAS seedFixtures() ici : son upsert de Stock remettrait
  // `reserved` à 0 et masquerait la réservation faite par le checkout.
  const admin = await prismaTest.user.findUniqueOrThrow({
    where: { email: "admin@shop.local" },
  });
  const token = newId();
  await prismaTest.session.create({
    data: { token, userId: admin.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return token;
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

describe("GET /api/payments/providers", () => {
  it("expose les 4 méthodes et leur disponibilité", async () => {
    const res = providersGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    const names = data.providers.map((p: { name: string }) => p.name);
    expect(names).toEqual(["mock", "mobile_money", "bank_transfer", "stripe"]);
    const stripe = data.providers.find((p: { name: string }) => p.name === "stripe");
    expect(stripe.available).toBe(false);
  });
});

describe("Checkout Mobile Money (asynchrone)", () => {
  it("checkout → PENDING_PAYMENT + redirectUrl USSD, puis callback → PAID + stock décrémenté", async () => {
    const { cart, variant } = await cartWithTshirt(2);
    const stockBefore = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });

    const res = await checkout(
      checkoutRequest(cart.id, {
        ...customer,
        paymentMethod: "mobile_money",
        operator: "ORANGE",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("PENDING_PAYMENT");
    expect(data.totalCents).toBe(2 * TSHIRT_PRICE + SHIPPING_CENTS);
    expect(data.redirectUrl).toMatch(/^\/paiement\/mobile-money\/mm_ORANGE_/);

    // La commande n'est PAS payée : le client n'a pas encore validé le USSD.
    const pending = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(pending.status).toBe("PENDING_PAYMENT");
    expect(pending.paymentProvider).toBe("mobile_money");
    expect(pending.payments[0]?.provider).toBe("mobile_money");
    expect(pending.payments[0]?.status).toBe("PENDING");
    expect(pending.payments[0]?.providerRef).toBe(data.paymentRef);

    // Stock réservé, pas décrémenté (ADR-004).
    const reserved = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(reserved.reserved).toBe(stockBefore.reserved + 2);
    expect(reserved.quantity).toBe(stockBefore.quantity);

    // ── Callback de l'opérateur ──
    const cb = await mmCallback(
      callbackRequest({
        providerRef: data.paymentRef,
        eventKey: "evt_mm_success_1",
        type: "payment.succeeded",
        status: "succeeded",
      }),
    );
    expect(cb.status).toBe(200);
    const cbData = await cb.json();
    expect(cbData.duplicate).toBe(false);
    expect(cbData.orderStatus).toBe("PAID");
    expect(cbData.paymentStatus).toBe("SUCCEEDED");

    const paid = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).toBeTruthy();
    expect(paid.payments[0]?.status).toBe("SUCCEEDED");

    const stockAfter = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 2);
    expect(stockAfter.reserved).toBe(0);

    // ── Rejeu du MÊME eventKey : idempotent, aucun double décrément ──
    const replay = await mmCallback(
      callbackRequest({
        providerRef: data.paymentRef,
        eventKey: "evt_mm_success_1",
        type: "payment.succeeded",
        status: "succeeded",
      }),
    );
    expect(replay.status).toBe(200);
    const replayData = await replay.json();
    expect(replayData.duplicate).toBe(true);

    const stockReplay = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(stockReplay.quantity).toBe(stockBefore.quantity - 2);
    expect(await prismaTest.webhookEvent.count()).toBe(1);
  });

  it("refuse un checkout Mobile Money sans opérateur", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "mobile_money" }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/operator/i);
  });

  it("callback sans eventKey → 400", async () => {
    const res = await mmCallback(
      callbackRequest({ providerRef: "mm_ORANGE_x", type: "payment.succeeded" }),
    );
    expect(res.status).toBe(400);
  });

  it("callback avec providerRef inconnu → 404", async () => {
    const res = await mmCallback(
      callbackRequest({
        providerRef: "mm_ORANGE_inconnu",
        eventKey: "evt_unknown",
        type: "payment.succeeded",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("callback d'échec → Payment FAILED, Order reste PENDING_PAYMENT", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, {
        ...customer,
        paymentMethod: "mobile_money",
        operator: "MTN",
      }),
    );
    const data = await res.json();
    // Ref contenant "fail" → capture renvoie "failed" (convention du mock).
    const failingRef = `mm_MTN_fail_${newId()}`;
    await prismaTest.payment.updateMany({
      where: { orderId: data.orderId },
      data: { providerRef: failingRef },
    });

    const cb = await mmCallback(
      callbackRequest({
        providerRef: failingRef,
        eventKey: "evt_mm_fail_1",
        type: "payment.failed",
        status: "failed",
      }),
    );
    expect(cb.status).toBe(200);
    const cbData = await cb.json();
    expect(cbData.paymentStatus).toBe("FAILED");
    expect(cbData.orderStatus).toBe("PENDING_PAYMENT");

    const order = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments[0]?.status).toBe("FAILED");
  });
});

describe("Checkout virement bancaire (validation manuelle)", () => {
  it("checkout → instructions IBAN, puis mark-paid admin → PAID + stock + AuditLog", async () => {
    const { cart, variant } = await cartWithTshirt(3);
    const stockBefore = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });

    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "bank_transfer" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("PENDING_PAYMENT");
    expect(data.redirectUrl).toMatch(/^\/paiement\/virement\/bt_/);

    const order = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(order.paymentProvider).toBe("bank_transfer");
    expect(order.payments[0]?.status).toBe("PENDING");

    // Sans session admin : 401.
    const anon = await markPaid(markPaidRequest(data.orderId), { params: { id: data.orderId } });
    expect(anon.status).toBe(401);

    // Avec session admin : PAID + stock réellement décrémenté.
    const token = await adminToken();
    const ok = await markPaid(markPaidRequest(data.orderId, token), {
      params: { id: data.orderId },
    });
    expect(ok.status).toBe(200);
    const okData = await ok.json();
    expect(okData.status).toBe("PAID");
    expect(okData.paymentStatus).toBe("SUCCEEDED");

    const paidOrder = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(paidOrder.status).toBe("PAID");
    expect(paidOrder.paidAt).toBeTruthy();
    expect(paidOrder.payments[0]?.status).toBe("SUCCEEDED");

    const stockAfter = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 3);
    expect(stockAfter.reserved).toBe(0);

    const audit = await prismaTest.auditLog.findFirst({
      where: { entityId: data.orderId, action: "order.mark_paid" },
    });
    expect(audit).toBeTruthy();

    // Rejouer mark-paid ne redécrémente pas le stock.
    const again = await markPaid(markPaidRequest(data.orderId, token), {
      params: { id: data.orderId },
    });
    expect(again.status).toBe(200);
    const againData = await again.json();
    expect(againData.idempotent).toBe(true);
    const stockFinal = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(stockFinal.quantity).toBe(stockBefore.quantity - 3);
  });

  it("mark-paid refuse une commande qui n'est pas un virement", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "mock" }),
    );
    const data = await res.json();
    const token = await adminToken();
    const ko = await markPaid(markPaidRequest(data.orderId, token), {
      params: { id: data.orderId },
    });
    expect(ko.status).toBe(409);
    const koData = await ko.json();
    expect(koData.code).toBe("NOT_BANK_TRANSFER");
  });
});

describe("Checkout mock — pilotage des scénarios", () => {
  it("scénario 'failure' → 402, Payment FAILED, réservation conservée", async () => {
    const { cart, variant } = await cartWithTshirt(1);
    const stockBefore = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });

    const res = await checkout(
      checkoutRequest(cart.id, {
        ...customer,
        paymentMethod: "mock",
        scenario: "failure",
      }),
    );
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.code).toBe("PAYMENT_FAILED");

    const order = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments[0]?.status).toBe("FAILED");

    const stockAfter = await prismaTest.stock.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(stockAfter.quantity).toBe(stockBefore.quantity);
    expect(stockAfter.reserved).toBe(stockBefore.reserved + 1);
  });

  it("scénario 'pending' → 200, Order PENDING_PAYMENT, Payment PENDING", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, {
        ...customer,
        paymentMethod: "mock",
        scenario: "pending",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("PENDING_PAYMENT");
    const order = await prismaTest.order.findUniqueOrThrow({
      where: { id: data.orderId },
      include: { payments: true },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments[0]?.status).toBe("PENDING");
  });

  it("rejette une méthode de paiement hors périmètre (stripe)", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "stripe" }),
    );
    expect(res.status).toBe(400);
    expect(await prismaTest.order.count()).toBe(0);
  });
});
