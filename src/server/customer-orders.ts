/**
 * Server layer — LECTURE des commandes du client connecté.
 *
 * Règle de sécurité structurante de ce module : **tout** `where` contient
 * `customerId`. L'id de commande vient d'une URL, donc d'un utilisateur : il ne
 * doit jamais servir seul de clé d'accès. La fonction de détail renvoie `null`
 * pour « inexistante » ET pour « appartient à quelqu'un d'autre », afin qu'un
 * client ne puisse pas sonder les ids d'autrui en comparant 404 et 403.
 *
 * Le suivi d'expédition (`Shipment`) est joint ici : c'est la donnée que le
 * client vient chercher dans son espace, et elle ne doit pas exiger une requête
 * supplémentaire depuis la page.
 */

import type { OrderStatus, PaymentStatus, ShipmentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

export const CUSTOMER_ORDERS_PAGE_SIZE = 10;

export type CustomerShipment = {
  id: string;
  carrier: string | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  shippedAt: Date | null;
  deliveredAt: Date | null;
};

export type CustomerOrderSummary = {
  id: string;
  number: string;
  placedAt: Date;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  paymentProvider: string;
  itemCount: number;
  /** Première expédition connue, ou `null` tant que la commande n'est pas expédiée. */
  shipment: CustomerShipment | null;
};

export type CustomerOrderItem = {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type CustomerOrderPayment = {
  id: string;
  provider: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
};

export type CustomerOrderDetail = {
  id: string;
  number: string;
  status: OrderStatus;
  placedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  subtotalCents: number;
  discountCents: number;
  /**
   * Code promo consommé par cette commande, `null` si aucun. Affiché à côté de
   * la ligne de remise : le client doit pouvoir vérifier que c'est bien SON
   * code qui a été appliqué, et se relire en cas de litige.
   */
  promoCode: string | null;
  shippingCents: number;
  totalCents: number;
  currency: string;
  paymentProvider: string;
  paymentRef: string | null;
  customerNote: string | null;
  items: CustomerOrderItem[];
  payments: CustomerOrderPayment[];
  shipments: CustomerShipment[];
  shippingAddress: {
    line1: string;
    line2: string | null;
    city: string;
    postalCode: string;
    country: string;
  };
  billingAddress:
    | { line1: string; line2: string | null; city: string; postalCode: string; country: string }
    | null;
  /** `true` quand la facturation reprend l'adresse de livraison (cas courant). */
  billingSameAsShipping: boolean;
};

export type CustomerOrdersPage = {
  orders: CustomerOrderSummary[];
  page: number;
  pageCount: number;
  total: number;
};

/**
 * Commandes du client, les plus récentes d'abord.
 *
 * La pagination est bornée côté serveur : un client avec 200 commandes ne doit
 * pas les charger toutes pour en afficher dix.
 */
export async function listCustomerOrders(
  customerId: string,
  options: { page?: number } = {},
): Promise<CustomerOrdersPage> {
  const requested = Number.isFinite(options.page) ? Math.floor(options.page ?? 1) : 1;
  const total = await prisma.order.count({ where: { customerId } });
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_ORDERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);

  const rows = await prisma.order.findMany({
    where: { customerId },
    orderBy: { placedAt: "desc" },
    skip: (page - 1) * CUSTOMER_ORDERS_PAGE_SIZE,
    take: CUSTOMER_ORDERS_PAGE_SIZE,
    include: {
      shipments: { orderBy: { shippedAt: "asc" } },
      _count: { select: { items: true } },
    },
  });

  return {
    page,
    pageCount,
    total,
    orders: rows.map((row) => ({
      id: row.id,
      number: row.number,
      placedAt: row.placedAt,
      status: row.status,
      totalCents: row.totalCents,
      currency: row.currency,
      paymentProvider: row.paymentProvider,
      itemCount: row._count.items,
      shipment: row.shipments[0] ? toShipmentDto(row.shipments[0]) : null,
    })),
  };
}

/**
 * Détail d'une commande, à condition qu'elle appartienne au client.
 * `null` sinon — l'appelant traduit en 404, jamais en 403.
 */
export async function getCustomerOrderDetail(
  customerId: string,
  orderId: string,
): Promise<CustomerOrderDetail | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    include: {
      items: true,
      payments: { orderBy: { id: "asc" } },
      shipments: { orderBy: { shippedAt: "asc" } },
      // Relations nommées : `address` = livraison (OrderShipping),
      // `billingAddress` = facturation (OrderBilling). La seconde est nulle
      // quand le client a facturé sur son adresse de livraison.
      address: true,
      billingAddress: true,
      // Code promo consommé (chantier E) : sert à afficher la remise avec son
      // code sur la commande. Relation 1–1 (`Order.redemption`).
      redemption: { include: { promoCode: { select: { code: true } } } },
    },
  });

  if (!order) return null;

  const shipping = {
    line1: order.address.line1,
    line2: order.address.line2,
    city: order.address.city,
    postalCode: order.address.postalCode,
    country: order.address.country,
  };

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    promoCode: order.redemption?.promoCode.code ?? null,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: order.currency,
    paymentProvider: order.paymentProvider,
    paymentRef: order.paymentRef,
    customerNote: order.customerNote,
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.quantity * item.unitPriceCents,
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      amountCents: payment.amountCents,
      currency: payment.currency,
      status: payment.status,
    })),
    shipments: order.shipments.map(toShipmentDto),
    shippingAddress: shipping,
    billingAddress: order.billingAddress
      ? {
          line1: order.billingAddress.line1,
          line2: order.billingAddress.line2,
          city: order.billingAddress.city,
          postalCode: order.billingAddress.postalCode,
          country: order.billingAddress.country,
        }
      : null,
    billingSameAsShipping: order.billingAddressId === null || order.billingAddressId === order.addressId,
  };
}

/** L'adresse par défaut du client, telle qu'elle serait pré-remplie au checkout. */
export async function getDefaultCustomerAddress(customerId: string): Promise<{
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
} | null> {
  const address = await prisma.address.findFirst({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { id: "desc" }],
  });
  if (!address) return null;
  return {
    id: address.id,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone,
  };
}

function toShipmentDto(shipment: {
  id: string;
  carrier: string | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}): CustomerShipment {
  return {
    id: shipment.id,
    carrier: shipment.carrier,
    trackingNo: shipment.trackingNo,
    trackingUrl: shipment.trackingUrl,
    status: shipment.status,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
  };
}
