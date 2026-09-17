/**
 * Server layer — orchestration du checkout invité.
 *
 * Deux fonctions principales :
 *  - createOrderFromCart : crée Customer + Address + Order + OrderItem +
 *    Payment dans une seule transaction. Décrémente Stock.reserved
 *    (pas Stock.quantity — c'est ADR-004). Marque Cart CONVERTED.
 *  - markOrderPaid       : appelé par le webhook mock → payment succeeded.
 *    Décrémente Stock.quantity - reserved et passe la commande à PAID.
 *
 * Invariants respectés :
 *  - Toutes les écritures sont transactionnelles (prisma.$transaction).
 *  - Le total est TOUJOURS recalculé serveur (jamais trusting client).
 *  - Les prix et noms sont snapshotés dans OrderItem au moment de la création.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { generateOrderNumber } from "@/domain/order";

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CART_NOT_FOUND"
      | "CART_EMPTY"
      | "CART_CONVERTED"
      | "OUT_OF_STOCK"
      | "VARIANT_NOT_FOUND"
      | "VARIANT_INACTIVE"
      | "CUSTOMER_INVALID"
      | "ADDRESS_INVALID"
      | "PAYMENT_FAILED"
      | "PAYMENT_PROVIDER_INVALID",
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Types d'entrée
// ─────────────────────────────────────────────────────────────────────

export type CustomerInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
};

export type AddressInput = {
  line1: string;
  line2?: string | undefined;
  city: string;
  postalCode: string;
  country: string;
};

export type CheckoutInput = {
  customer: CustomerInput;
  /** Adresse de livraison (toujours présente) */
  shippingAddress: AddressInput;
  /** Adresse de facturation (si différente) */
  billingAddress?: AddressInput | undefined;
  /** Méthode de paiement ("mock" uniquement en S2) */
  paymentMethod: "mock";
  /** Forfait livraison en centimes (par défaut lu depuis env) */
  shippingCents: number;
  /** Devise (par défaut "EUR") */
  currency: string;
};

export type CreateOrderResult = {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  paymentRef: string;
};

// ─────────────────────────────────────────────────────────────────────
// Compteur de séquence pour generateOrderNumber
// ─────────────────────────────────────────────────────────────────────

/**
 * Lit un numéro de séquence mono-process pour `generateOrderNumber`.
 * En MVP / faible volumétrie : on compte les Order déjà créés cette année
 * et on ajoute 1. Pour passer à 1000+ commandes/jour, basculer sur une
 * table dédiée `OrderSequence` avec verrou advisory (S3+).
 */
async function nextOrderSeq(tx: Prisma.TransactionClient, year: number): Promise<number> {
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const startOfNextYear = new Date(Date.UTC(year + 1, 0, 1));
  const count = await tx.order.count({
    where: { placedAt: { gte: startOfYear, lt: startOfNextYear } },
  });
  return count + 1;
}

// ─────────────────────────────────────────────────────────────────────
// createOrderFromCart
// ─────────────────────────────────────────────────────────────────────

/**
 * Crée la commande à partir d'un Cart ACTIVE et des infos client/adresse.
 * - Le Cart passe en CONVERTED dans la même transaction.
 * - Le Payment est créé en PENDING avec providerRef issu du PSP.
 * - Le stock est réservé (Stock.reserved += quantity).
 *
 * Renvoie les infos pour que le caller puisse appeler ensuite
 * `capture` puis `markOrderPaid`.
 */
export async function createOrderFromCart(
  cartId: string,
  input: CheckoutInput,
  params: {
    createPaymentIntent: () => Promise<{ providerRef: string; expiresAt: Date | null }>;
  },
): Promise<CreateOrderResult> {
  if (input.paymentMethod !== "mock") {
    throw new CheckoutError(
      `Méthode de paiement non supportée: ${input.paymentMethod}`,
      "PAYMENT_PROVIDER_INVALID",
    );
  }

  const year = new Date().getFullYear();

  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: { variant: { include: { product: true, stock: true } } },
        },
      },
    });

    if (!cart) {
      throw new CheckoutError(`Cart introuvable: ${cartId}`, "CART_NOT_FOUND");
    }
    if (cart.status !== "ACTIVE") {
      throw new CheckoutError(`Cart ${cartId} n'est pas ACTIVE`, "CART_CONVERTED");
    }
    if (cart.items.length === 0) {
      throw new CheckoutError(`Cart ${cartId} est vide`, "CART_EMPTY");
    }

    // 1) Vérifier disponibilité réelle (quantity - reserved) pour chaque ligne.
    for (const item of cart.items) {
      const v = item.variant;
      if (!v.active || !v.product.active) {
        throw new CheckoutError(
          `Variant ${v.id} inactif ou produit inactif`,
          "VARIANT_INACTIVE",
        );
      }
      const stockQty = v.stock?.quantity ?? 0;
      const stockReserved = v.stock?.reserved ?? 0;
      const available = stockQty - stockReserved;
      if (item.quantity > available) {
        throw new CheckoutError(
          `Stock insuffisant pour ${v.sku}: demandé ${item.quantity}, dispo ${available}`,
          "OUT_OF_STOCK",
        );
      }
    }

    // 2) Customer (par email — un email = un client fidèle à la commande)
    const customer = await tx.customer.upsert({
      where: { email: input.customer.email.toLowerCase() },
      update: {
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        ...(input.customer.phone !== undefined ? { phone: input.customer.phone } : {}),
      },
      create: {
        email: input.customer.email.toLowerCase(),
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        ...(input.customer.phone !== undefined ? { phone: input.customer.phone } : {}),
      },
    });

    // 3) Addresses (shipping + billing si différente)
    const shippingAddr = await tx.address.create({
      data: {
        customerId: customer.id,
        line1: input.shippingAddress.line1,
        ...(input.shippingAddress.line2 !== undefined ? { line2: input.shippingAddress.line2 } : {}),
        city: input.shippingAddress.city,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
      },
    });
    const billingAddr = input.billingAddress
      ? await tx.address.create({
          data: {
            customerId: customer.id,
            line1: input.billingAddress.line1,
            ...(input.billingAddress.line2 !== undefined ? { line2: input.billingAddress.line2 } : {}),
            city: input.billingAddress.city,
            postalCode: input.billingAddress.postalCode,
            country: input.billingAddress.country,
          },
        })
      : shippingAddr;

    // 4) Totaux serveur (on ne fait JAMAIS confiance au client)
    const subtotalCents = cart.items.reduce(
      (acc, i) => acc + i.quantity * i.unitPriceCents,
      0,
    );
    const shippingCents = input.shippingCents;
    const totalCents = subtotalCents + shippingCents;
    const currency = input.currency || cart.currency || "EUR";

    // 5) Numéro de commande lisible
    const seq = await nextOrderSeq(tx, year);
    const orderNumber = generateOrderNumber(seq, year);

    // 6) Order + OrderItems + décrément Stock.reserved + marque Cart CONVERTED
    const order = await tx.order.create({
      data: {
        number: orderNumber,
        customerId: customer.id,
        addressId: shippingAddr.id, // adresse de livraison = référence canonique
        status: "PENDING_PAYMENT",
        subtotalCents,
        shippingCents,
        totalCents,
        currency,
        paymentProvider: "mock",
        paymentRef: null, // mis après createPaymentIntent ci-dessous
        items: {
          create: cart.items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            productNameSnapshot: i.variant.product.name,
            variantNameSnapshot: i.variant.name,
          })),
        },
      },
    });

    for (const item of cart.items) {
      const current = await tx.stock.findUnique({ where: { variantId: item.variantId } });
      const newReserved = (current?.reserved ?? 0) + item.quantity;
      await tx.stock.upsert({
        where: { variantId: item.variantId },
        update: { reserved: newReserved },
        create: { variantId: item.variantId, quantity: 0, reserved: newReserved },
      });
    }

    // Note : on stocke l'adresse billing uniquement si elle est distincte
    // (sinon Order.addressId pointe déjà sur shipping). Pour S2, on garde
    // la même adresse physique ; le distinguo "billing same as shipping"
    // est porté par OrderItem/customer dans une version ultérieure si besoin.
    void billingAddr;

    await tx.cart.update({
      where: { id: cartId },
      data: { status: "CONVERTED", updatedAt: new Date() },
    });

    // 7) Payment intent (mock) — providerRef sert d'id côté PSP
    const intent = await params.createPaymentIntent();
    await tx.order.update({
      where: { id: order.id },
      data: { paymentRef: intent.providerRef },
    });

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        providerRef: intent.providerRef,
        amountCents: totalCents,
        currency,
        status: "PENDING",
      },
    });

    return {
      orderId: order.id,
      orderNumber,
      totalCents,
      paymentRef: intent.providerRef,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// markOrderPaid
// ─────────────────────────────────────────────────────────────────────

/**
 * Appelé après confirmation du paiement (webhook ou capture immédiate mock) :
 *  - Order.status → PAID, paidAt = now
 *  - Payment.status → SUCCEEDED
 *  - Stock.quantity -= reserved (la quantité réelle part)
 *  - Stock.reserved → 0
 *
 * Renvoie l'id de la commande. Idempotent : si déjà PAID, renvoie sans rien faire.
 */
export async function markOrderPaid(orderId: string): Promise<{ orderId: string }> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) {
      throw new CheckoutError(`Order introuvable: ${orderId}`, "CART_NOT_FOUND");
    }
    if (order.status === "PAID") {
      // déjà payé → no-op idempotent
      return;
    }
    if (order.status !== "PENDING_PAYMENT") {
      throw new CheckoutError(
        `Order ${orderId} ne peut pas passer à PAID depuis ${order.status}`,
        "PAYMENT_FAILED",
      );
    }

    const now = new Date();

    // Décrément final du stock : quantity -= reserved, reserved -> 0
    for (const item of order.items) {
      const stock = await tx.stock.findUnique({ where: { variantId: item.variantId } });
      const reserved = stock?.reserved ?? 0;
      const quantity = stock?.quantity ?? 0;
      const reservedForThisItem = Math.min(reserved, item.quantity);
      const newQuantity = Math.max(0, quantity - reservedForThisItem);
      const newReserved = Math.max(0, reserved - reservedForThisItem);
      await tx.stock.update({
        where: { variantId: item.variantId },
        data: { quantity: newQuantity, reserved: newReserved },
      });
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID", paidAt: now },
    });

    await tx.payment.updateMany({
      where: { orderId, status: "PENDING" },
      data: { status: "SUCCEEDED" },
    });
  });

  return { orderId };
}
