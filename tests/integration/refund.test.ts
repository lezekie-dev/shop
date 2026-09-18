import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db";
import { createId } from "@paralleldrive/cuid2";
import { refundOrder } from "@/server/payments";

/**
 * Remboursement — tests d'intégration sur Postgres réel.
 *
 * On teste `refundOrder` (la répercussion en base) séparément de l'appel PSP :
 * c'est la partie qui manipule l'argent *et* le stock, donc celle où un bug
 * coûte cher. Le contrat :
 *   - PAID → REFUNDED, Payment → REFUNDED
 *   - le stock revient (+= quantité commandée)
 *   - rejouer le remboursement ne double JAMAIS le stock (idempotence)
 *   - une commande non payée ne peut pas être remboursée
 */

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "OrderItem","Payment","Shipment","Order","CartItem","Cart","Stock","Variant","Product","Category","Customer","Address","AuditLog","WebhookEvent","EmailOutbox","Session","User" RESTART IDENTITY CASCADE',
  );
}

/** Crée une commande payée prête à être remboursée, avec stock cohérent. */
async function seedPaidOrder(quantity: number, initialStock: number) {
  const customer = await prisma.customer.create({
    data: { email: `refund-${createId()}@example.com`, firstName: "Re", lastName: "Fund" },
  });
  const address = await prisma.address.create({
    data: {
      customerId: customer.id,
      line1: "1 rue du Test",
      city: "Paris",
      postalCode: "75001",
      country: "FR",
    },
  });
  const category = await prisma.category.create({
    data: { slug: `cat-${createId()}`, name: "Catégorie test" },
  });
  const product = await prisma.product.create({
    data: {
      slug: `prod-${createId()}`,
      name: "Produit test",
      description: "Pour les tests de remboursement",
      categoryId: category.id,
    },
  });
  const variant = await prisma.variant.create({
    data: {
      productId: product.id,
      sku: `SKU-${createId()}`,
      name: "Unique",
      priceCents: 2500,
      attributes: {},
    },
  });
  // Après un passage à PAID, le stock réel a été décrémenté de la quantité vendue.
  await prisma.stock.create({
    data: {
      variantId: variant.id,
      quantity: initialStock - quantity,
      reserved: 0,
    },
  });

  const order = await prisma.order.create({
    data: {
      number: `ORD-TEST-${createId().slice(0, 8)}`,
      customerId: customer.id,
      addressId: address.id,
      status: "PAID",
      subtotalCents: 2500 * quantity,
      shippingCents: 0,
      totalCents: 2500 * quantity,
      currency: "EUR",
      paymentProvider: "mock",
      paymentRef: `mock_${createId()}`,
      paidAt: new Date(),
      items: {
        create: {
          variantId: variant.id,
          quantity,
          unitPriceCents: 2500,
          productNameSnapshot: "Produit test",
          variantNameSnapshot: "Unique",
        },
      },
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "mock",
      providerRef: order.paymentRef!,
      amountCents: 2500 * quantity,
      currency: "EUR",
      status: "SUCCEEDED",
    },
  });

  return { order, variant, payment, quantity, initialStock };
}

describe("refundOrder", () => {
  beforeEach(async () => {
    await truncateAll();
    // Un admin existe pour satisfaire d'éventuelles FK d'audit.
    await prisma.user.create({
      data: {
        email: `admin-${createId()}@shop.local`,
        passwordHash: await bcrypt.hash("x", 4),
        role: "ADMIN",
      },
    });
  });

  it("passe la commande en REFUNDED et remet le stock", async () => {
    const { order, variant, payment, quantity, initialStock } = await seedPaidOrder(3, 10);

    const before = await prisma.stock.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(before.quantity).toBe(initialStock - quantity);

    const result = await refundOrder(order.id, {
      amountCents: payment.amountCents,
      providerRef: payment.providerRef,
      refundRef: `re_test_${createId()}`,
      reason: "Client mécontent",
    });

    expect(result.orderStatus).toBe("REFUNDED");
    expect(result.paymentStatus).toBe("REFUNDED");
    expect(result.idempotent).toBe(false);
    expect(result.stockRestored).toBe(true);

    const after = await prisma.stock.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(after.quantity).toBe(initialStock); // 10 entier

    const refreshed = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(refreshed.status).toBe("REFUNDED");
    expect(refreshed.cancelledAt).not.toBeNull();
    expect(refreshed.payments[0]!.status).toBe("REFUNDED");
  });

  it("est idempotent : rejouer ne double pas le stock", async () => {
    const { order, variant, payment, initialStock } = await seedPaidOrder(2, 8);

    await refundOrder(order.id, {
      amountCents: payment.amountCents,
      providerRef: payment.providerRef,
      refundRef: `re_a_${createId()}`,
      reason: null,
    });
    const afterFirst = await prisma.stock.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(afterFirst.quantity).toBe(initialStock);

    const second = await refundOrder(order.id, {
      amountCents: payment.amountCents,
      providerRef: payment.providerRef,
      refundRef: `re_b_${createId()}`,
      reason: null,
    });

    expect(second.idempotent).toBe(true);
    expect(second.stockRestored).toBe(false);

    const afterSecond = await prisma.stock.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(afterSecond.quantity).toBe(initialStock); // surtout pas 12
  });

  it("refuse de rembourser une commande jamais payée", async () => {
    const { order, payment } = await seedPaidOrder(1, 5);
    await prisma.order.update({ where: { id: order.id }, data: { status: "PENDING_PAYMENT" } });

    await expect(
      refundOrder(order.id, {
        amountCents: payment.amountCents,
        providerRef: payment.providerRef,
        refundRef: `re_c_${createId()}`,
        reason: null,
      }),
    ).rejects.toThrow(/ne peut pas être remboursée/);
  });

  it("refuse une commande déjà annulée", async () => {
    const { order, payment } = await seedPaidOrder(1, 5);
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

    await expect(
      refundOrder(order.id, {
        amountCents: payment.amountCents,
        providerRef: payment.providerRef,
        refundRef: `re_d_${createId()}`,
        reason: null,
      }),
    ).rejects.toThrow(/INVALID_TRANSITION|ne peut pas être remboursée/);
  });

  it("jette si la commande n'existe pas", async () => {
    await expect(
      refundOrder("id-inexistant", {
        amountCents: 100,
        providerRef: null,
        refundRef: "re_x",
        reason: null,
      }),
    ).rejects.toThrow(/Order introuvable/);
  });

  it("rembourse aussi une commande SHIPPED", async () => {
    const { order, variant, payment, initialStock } = await seedPaidOrder(2, 9);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "SHIPPED", shippedAt: new Date() },
    });

    const result = await refundOrder(order.id, {
      amountCents: payment.amountCents,
      providerRef: payment.providerRef,
      refundRef: `re_e_${createId()}`,
      reason: "Retour marchandise",
    });

    expect(result.orderStatus).toBe("REFUNDED");
    const after = await prisma.stock.findUniqueOrThrow({ where: { variantId: variant.id } });
    expect(after.quantity).toBe(initialStock);
  });
});
