import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { POST as checkout } from "@/app/api/checkout/route";
import { POST as mmCallback } from "@/app/api/payments/mobile-money/callback/route";
import { POST as markPaid } from "@/app/api/admin/orders/[id]/mark-paid/route";
import { POST as markShipped } from "@/app/api/admin/orders/[id]/mark-shipped/route";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";
import { CART_COOKIE_NAME, getOrCreateCart } from "@/server/cart";
import { newId } from "@/lib/ids";
import { emailProviderNotConfigured, selectEmailSender } from "@/server/email";

const BUYER_EMAIL = "buyer@shop.local";

const customer = {
  email: BUYER_EMAIL,
  firstName: "Aïcha",
  lastName: "Dupont",
  phone: "+237600000001",
  address: { line1: "12 rue des Lilas", city: "Douala", postalCode: "00237", country: "FR" },
  billingAddressSame: true,
};

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

function adminRequest(url: string, token: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      cookie: `admin_session=${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

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

async function adminToken(): Promise<string> {
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

describe("selectEmailSender (aucun compte tiers requis)", () => {
  it("renvoie l'outbox par défaut, sans configuration", () => {
    const sender = selectEmailSender();
    expect(sender.constructor.name).toBe("OutboxEmailSender");
  });

  it("jette un message explicite pour resend / smtp", () => {
    expect(() => selectEmailSender("resend")).toThrow(/RESEND_API_KEY/);
    expect(() => selectEmailSender("smtp")).toThrow(/SMTP_URL/);
    expect(emailProviderNotConfigured("resend")).toMatch(/outbox/i);
    expect(() => selectEmailSender("carrier-pigeon")).toThrow(/inconnu/i);
  });
});

describe("Outbox email — confirmation de commande", () => {
  it("après un checkout mock payé : 1 email en base, bon destinataire et numéro de commande", async () => {
    const { cart } = await cartWithTshirt(2);

    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "mock" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    const emails = await prismaTest.emailOutbox.findMany();
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.to).toBe(BUYER_EMAIL);
    expect(email.template).toBe("order_confirmation");
    expect(email.provider).toBe("outbox");
    expect(email.orderId).toBe(data.orderId);
    expect(email.subject).toContain(data.orderNumber);
    expect(email.bodyText).toContain(data.orderNumber);
    expect(email.bodyText).toContain("Douala");
    expect(email.bodyText).toMatch(/Total/);
    expect(email.bodyHtml).toContain(data.orderNumber);
  });

  it("Mobile Money : l'email part à la confirmation du callback, une seule fois", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, {
        ...customer,
        paymentMethod: "mobile_money",
        operator: "ORANGE",
      }),
    );
    const data = await res.json();

    // Commande non payée → pas encore de confirmation.
    expect(await prismaTest.emailOutbox.count()).toBe(0);

    const cb = await mmCallback(
      callbackRequest({
        providerRef: data.paymentRef,
        eventKey: "evt_email_1",
        type: "payment.succeeded",
        status: "succeeded",
      }),
    );
    expect(cb.status).toBe(200);
    expect(await prismaTest.emailOutbox.count()).toBe(1);

    // Rejeu du même événement → toujours un seul email.
    await mmCallback(
      callbackRequest({
        providerRef: data.paymentRef,
        eventKey: "evt_email_1",
        type: "payment.succeeded",
        status: "succeeded",
      }),
    );
    expect(await prismaTest.emailOutbox.count()).toBe(1);
  });

  it("Virement bancaire : l'email part à la validation admin (mark-paid)", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "bank_transfer" }),
    );
    const data = await res.json();
    expect(await prismaTest.emailOutbox.count()).toBe(0);

    const token = await adminToken();
    const paid = await markPaid(
      adminRequest(
        `http://localhost:3000/api/admin/orders/${data.orderId}/mark-paid`,
        token,
      ),
      { params: { id: data.orderId } },
    );
    expect(paid.status).toBe(200);

    const emails = await prismaTest.emailOutbox.findMany();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe(BUYER_EMAIL);
    expect(emails[0]?.subject).toContain(data.orderNumber);
  });
});

describe("Outbox email — expédition", () => {
  it("mark-shipped envoie l'email d'expédition avec transporteur + suivi", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "mock" }),
    );
    const data = await res.json();

    const token = await adminToken();
    const shipped = await markShipped(
      adminRequest(
        `http://localhost:3000/api/admin/orders/${data.orderId}/mark-shipped`,
        token,
        { carrier: "Chronopost Démo", trackingNo: "CP-123456" },
      ),
      { params: { id: data.orderId } },
    );
    expect(shipped.status).toBe(200);
    const shippedData = await shipped.json();
    expect(shippedData.status).toBe("SHIPPED");
    expect(shippedData.trackingNo).toBe("CP-123456");

    const order = await prismaTest.order.findUniqueOrThrow({ where: { id: data.orderId } });
    expect(order.status).toBe("SHIPPED");
    expect(order.shippedAt).toBeTruthy();
    expect(await prismaTest.shipment.count({ where: { orderId: data.orderId } })).toBe(1);

    const emails = await prismaTest.emailOutbox.findMany({ orderBy: { sentAt: "asc" } });
    expect(emails).toHaveLength(2);
    const shippedEmail = emails.find((e) => e.template === "order_shipped");
    expect(shippedEmail).toBeTruthy();
    expect(shippedEmail?.to).toBe(BUYER_EMAIL);
    expect(shippedEmail?.bodyText).toContain("CP-123456");
    expect(shippedEmail?.bodyText).toContain("Chronopost Démo");
  });

  it("mark-shipped est refusé sans session admin et sans effet de bord", async () => {
    const { cart } = await cartWithTshirt(1);
    const res = await checkout(
      checkoutRequest(cart.id, { ...customer, paymentMethod: "mock" }),
    );
    const data = await res.json();

    const anon = await markShipped(
      new NextRequest(`http://localhost:3000/api/admin/orders/${data.orderId}/mark-shipped`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ carrier: "X" }),
      }),
      { params: { id: data.orderId } },
    );
    expect(anon.status).toBe(401);
    expect(await prismaTest.shipment.count()).toBe(0);
    expect(await prismaTest.emailOutbox.count()).toBe(1); // seulement la confirmation
  });
});
