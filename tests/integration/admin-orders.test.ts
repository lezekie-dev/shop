import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { OrderStatus } from "@prisma/client";

import { POST as markPaid } from "@/app/api/admin/orders/[id]/mark-paid/route";
import { POST as markShipped } from "@/app/api/admin/orders/[id]/mark-shipped/route";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";
import { newId } from "@/lib/ids";
import { generateOrderAccessToken } from "@/lib/order-token";
import {
  countOrdersByStatus,
  getAdminOrderDetail,
  listAdminOrders,
} from "@/server/admin-orders";

// ─────────────────────────────────────────────────────────────────────
// Fabriques
// ─────────────────────────────────────────────────────────────────────

let seq = 0;

type OrderOptions = {
  status?: OrderStatus;
  totalCents?: number;
  placedAt?: Date;
  paymentProvider?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

async function createOrder(opts: OrderOptions = {}): Promise<{
  orderId: string;
  number: string;
  variantId: string;
}> {
  seq += 1;
  const provider = opts.paymentProvider ?? "mock";
  const totalCents = opts.totalCents ?? 1_990;
  const placedAt = opts.placedAt ?? new Date(2026, 8, 10, 12, 0, 0);
  const status = opts.status ?? "PAID";

  const variant = await prismaTest.variant.findFirstOrThrow();
  const customer = await prismaTest.customer.create({
    data: {
      email: opts.email ?? `buyer-${seq}@shop.local`,
      firstName: opts.firstName ?? "Aïcha",
      lastName: opts.lastName ?? "Dupont",
      phone: "+237600000000",
    },
  });
  const address = await prismaTest.address.create({
    data: {
      customerId: customer.id,
      line1: "12 rue des Lilas",
      city: "Douala",
      postalCode: "00237",
      country: "FR",
    },
  });

  const number = `ORD-2026-${`${seq}`.padStart(6, "0")}`;
  const order = await prismaTest.order.create({
    data: {
      number,
      accessToken: generateOrderAccessToken(),
      customerId: customer.id,
      addressId: address.id,
      status,
      subtotalCents: totalCents,
      shippingCents: 0,
      totalCents,
      currency: "EUR",
      paymentProvider: provider,
      paymentRef: `${provider}_${seq}`,
      placedAt,
      paidAt: status === "PENDING_PAYMENT" ? null : placedAt,
      items: {
        create: [
          {
            variantId: variant.id,
            quantity: 1,
            unitPriceCents: totalCents,
            productNameSnapshot: "T-shirt basique blanc",
            variantNameSnapshot: "Blanc / M",
          },
        ],
      },
      payments: {
        create: [
          {
            provider,
            providerRef: `${provider}_${seq}`,
            amountCents: totalCents,
            currency: "EUR",
            status: status === "PENDING_PAYMENT" ? "PENDING" : "SUCCEEDED",
          },
        ],
      },
    },
  });

  return { orderId: order.id, number, variantId: variant.id };
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

function postRequest(url: string, token?: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      ...(token ? { cookie: `admin_session=${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(async () => {
  await resetDb();
  await seedFixtures();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────
// Liste des commandes
// ─────────────────────────────────────────────────────────────────────

describe("liste des commandes", () => {
  it("renvoie les commandes de la plus récente à la plus ancienne", async () => {
    const older = await createOrder({ placedAt: new Date(2026, 8, 1, 9, 0, 0) });
    const newer = await createOrder({ placedAt: new Date(2026, 8, 15, 9, 0, 0) });
    const middle = await createOrder({ placedAt: new Date(2026, 8, 8, 9, 0, 0) });

    const { rows, meta } = await listAdminOrders({});
    expect(meta.total).toBe(3);
    expect(rows.map((r) => r.id)).toEqual([newer.orderId, middle.orderId, older.orderId]);
  });

  it("expose le nom du client et son email", async () => {
    await createOrder({ firstName: "Marc", lastName: "Nkolo", email: "marc@example.com" });
    const { rows } = await listAdminOrders({});
    expect(rows[0]?.customerName).toBe("Marc Nkolo");
    expect(rows[0]?.customerEmail).toBe("marc@example.com");
  });

  it("retombe sur l'email quand le client n'a pas de nom", async () => {
    seq += 1;
    const variant = await prismaTest.variant.findFirstOrThrow();
    const customer = await prismaTest.customer.create({
      data: { email: "anonyme@shop.local" },
    });
    const address = await prismaTest.address.create({
      data: {
        customerId: customer.id,
        line1: "1 rue",
        city: "Douala",
        postalCode: "00237",
        country: "FR",
      },
    });
    await prismaTest.order.create({
      data: {
        number: `ORD-2026-90000${seq}`,
        accessToken: generateOrderAccessToken(),
        customerId: customer.id,
        addressId: address.id,
        status: "PAID",
        subtotalCents: 1_000,
        shippingCents: 0,
        totalCents: 1_000,
        currency: "EUR",
        paymentProvider: "mock",
        placedAt: new Date(2026, 8, 12, 9, 0, 0),
        items: {
          create: [
            {
              variantId: variant.id,
              quantity: 1,
              unitPriceCents: 1_000,
              productNameSnapshot: "Sac tote en canvas",
              variantNameSnapshot: "Naturel",
            },
          ],
        },
      },
    });

    const { rows } = await listAdminOrders({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerName).toBe("anonyme@shop.local");
  });

  it("filtre par statut et ne renvoie que celui-ci", async () => {
    await createOrder({ status: "PENDING_PAYMENT" });
    await createOrder({ status: "PAID" });
    await createOrder({ status: "PAID" });
    await createOrder({ status: "SHIPPED" });

    const paid = await listAdminOrders({ status: "PAID" });
    expect(paid.meta.total).toBe(2);
    expect(paid.rows.every((r) => r.status === "PAID")).toBe(true);

    const shipped = await listAdminOrders({ status: "SHIPPED" });
    expect(shipped.meta.total).toBe(1);

    const refunded = await listAdminOrders({ status: "REFUNDED" });
    expect(refunded.meta.total).toBe(0);
    expect(refunded.rows).toEqual([]);

    const all = await listAdminOrders({});
    expect(all.meta.total).toBe(4);
  });

  it("pagine 20 commandes par page", async () => {
    // Un seul client + une seule adresse pour les 25 commandes : le test porte
    // sur la pagination, pas sur la création de 25 carnets d'adresses.
    seq += 1;
    const variant = await prismaTest.variant.findFirstOrThrow();
    const customer = await prismaTest.customer.create({
      data: { email: `bulk-${seq}@shop.local`, firstName: "Aïcha", lastName: "Dupont" },
    });
    const address = await prismaTest.address.create({
      data: {
        customerId: customer.id,
        line1: "12 rue des Lilas",
        city: "Douala",
        postalCode: "00237",
        country: "FR",
      },
    });

    for (let i = 0; i < 25; i += 1) {
      await prismaTest.order.create({
        data: {
          number: `ORD-2026-8${`${i}`.padStart(5, "0")}`,
          accessToken: generateOrderAccessToken(),
          customerId: customer.id,
          addressId: address.id,
          status: "PAID",
          subtotalCents: 1_000,
          shippingCents: 0,
          totalCents: 1_000,
          currency: "EUR",
          paymentProvider: "mock",
          placedAt: new Date(2026, 7, 1 + i, 10, 0, 0),
        },
      });
    }

    const page1 = await listAdminOrders({ page: 1 });
    expect(page1.meta.total).toBe(25);
    expect(page1.meta.pageCount).toBe(2);
    expect(page1.rows).toHaveLength(20);

    const page2 = await listAdminOrders({ page: 2 });
    expect(page2.rows).toHaveLength(5);

    // Les deux pages ne se recouvrent pas.
    const ids = new Set([...page1.rows, ...page2.rows].map((r) => r.id));
    expect(ids.size).toBe(25);

    // Page hors bornes → dernière page réelle, jamais une liste vide.
    const overflow = await listAdminOrders({ page: 42 });
    expect(overflow.meta.page).toBe(2);
    expect(overflow.rows).toHaveLength(5);

    // La première page commence bien par la commande la plus récente.
    expect(page1.rows[0]?.placedAt.getTime()).toBeGreaterThan(
      page1.rows[19]?.placedAt.getTime() ?? 0,
    );
    expect(variant.id).toBeTruthy();
  });

  it("compte les commandes par statut, zéros inclus", async () => {
    await createOrder({ status: "PENDING_PAYMENT" });
    await createOrder({ status: "PENDING_PAYMENT" });
    await createOrder({ status: "PAID" });

    const counts = await countOrdersByStatus();
    expect(counts.PENDING_PAYMENT).toBe(2);
    expect(counts.PAID).toBe(1);
    expect(counts.PREPARING).toBe(0);
    expect(counts.SHIPPED).toBe(0);
    expect(counts.DELIVERED).toBe(0);
    expect(counts.CANCELLED).toBe(0);
    expect(counts.REFUNDED).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Détail
// ─────────────────────────────────────────────────────────────────────

describe("détail d'une commande", () => {
  it("renvoie articles, client, adresse et paiement", async () => {
    const { orderId, number } = await createOrder({
      totalCents: 2_580,
      paymentProvider: "bank_transfer",
      status: "PENDING_PAYMENT",
      firstName: "Fatou",
      lastName: "Biya",
      email: "fatou@example.com",
    });

    const detail = await getAdminOrderDetail(orderId);
    expect(detail).not.toBeNull();
    expect(detail?.number).toBe(number);
    expect(detail?.status).toBe("PENDING_PAYMENT");
    expect(detail?.paymentProvider).toBe("bank_transfer");
    expect(detail?.customer.name).toBe("Fatou Biya");
    expect(detail?.customer.email).toBe("fatou@example.com");
    expect(detail?.address.city).toBe("Douala");
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0]?.productName).toBe("T-shirt basique blanc");
    expect(detail?.items[0]?.unitPriceCents).toBe(2_580);
    expect(detail?.payments).toHaveLength(1);
    expect(detail?.payments[0]?.status).toBe("PENDING");
    expect(detail?.shipments).toEqual([]);
    expect(detail?.paidAt).toBeNull();
  });

  it("inclut les expéditions quand elles existent", async () => {
    const { orderId } = await createOrder({ status: "SHIPPED" });
    await prismaTest.shipment.create({
      data: {
        orderId,
        carrier: "Chronopost Démo",
        trackingNo: "CP-999",
        status: "IN_TRANSIT",
        shippedAt: new Date(2026, 8, 11, 8, 0, 0),
      },
    });

    const detail = await getAdminOrderDetail(orderId);
    expect(detail?.shipments).toHaveLength(1);
    expect(detail?.shipments[0]?.carrier).toBe("Chronopost Démo");
    expect(detail?.shipments[0]?.trackingNo).toBe("CP-999");
  });

  it("renvoie null pour une commande inconnue", async () => {
    expect(await getAdminOrderDetail("commande-inexistante")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Protection des actions
// ─────────────────────────────────────────────────────────────────────

describe("protection des actions admin", () => {
  it("mark-paid renvoie 401 sans session admin et n'écrit rien", async () => {
    const { orderId } = await createOrder({
      status: "PENDING_PAYMENT",
      paymentProvider: "bank_transfer",
    });

    const res = await markPaid(
      postRequest(`http://localhost:3000/api/admin/orders/${orderId}/mark-paid`),
      { params: { id: orderId } },
    );
    expect(res.status).toBe(401);

    const order = await prismaTest.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.paidAt).toBeNull();
    expect(await prismaTest.auditLog.count()).toBe(0);
    expect(await prismaTest.emailOutbox.count()).toBe(0);
  });

  it("mark-shipped renvoie 401 sans session admin et n'écrit rien", async () => {
    const { orderId } = await createOrder({ status: "PAID" });

    const res = await markShipped(
      postRequest(`http://localhost:3000/api/admin/orders/${orderId}/mark-shipped`, undefined, {
        carrier: "Chronopost Démo",
      }),
      { params: { id: orderId } },
    );
    expect(res.status).toBe(401);

    const order = await prismaTest.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(await prismaTest.shipment.count()).toBe(0);
  });

  it("mark-shipped accepte la session admin et journalise l'action", async () => {
    const { orderId } = await createOrder({ status: "PAID" });
    const token = await adminToken();

    const res = await markShipped(
      postRequest(
        `http://localhost:3000/api/admin/orders/${orderId}/mark-shipped`,
        token,
        { carrier: "Chronopost Démo", trackingNo: "CP-123456" },
      ),
      { params: { id: orderId } },
    );
    expect(res.status).toBe(200);

    const order = await prismaTest.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("SHIPPED");
    expect(order.shippedAt).not.toBeNull();
    expect(await prismaTest.shipment.count({ where: { orderId } })).toBe(1);

    const logs = await prismaTest.auditLog.findMany({ where: { entityId: orderId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("order.mark_shipped");
  });

  it("mark-paid accepte la session admin sur un virement en attente", async () => {
    const { orderId } = await createOrder({
      status: "PENDING_PAYMENT",
      paymentProvider: "bank_transfer",
    });
    const token = await adminToken();

    const res = await markPaid(
      postRequest(`http://localhost:3000/api/admin/orders/${orderId}/mark-paid`, token),
      { params: { id: orderId } },
    );
    expect(res.status).toBe(200);

    const order = await prismaTest.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paidAt).not.toBeNull();
  });

  it("mark-paid refuse une commande qui n'est pas un virement", async () => {
    const { orderId } = await createOrder({
      status: "PENDING_PAYMENT",
      paymentProvider: "mobile_money",
    });
    const token = await adminToken();

    const res = await markPaid(
      postRequest(`http://localhost:3000/api/admin/orders/${orderId}/mark-paid`, token),
      { params: { id: orderId } },
    );
    expect(res.status).toBe(409);

    const order = await prismaTest.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PENDING_PAYMENT");
  });
});
