/**
 * Lecture des commandes pour le back-office.
 *
 * Les pages admin n'importent jamais Prisma directement : elles consomment les
 * fonctions de ce module, qui renvoient des structures prêtes à afficher.
 *
 * Les helpers purs (pagination, construction d'URL, prédicats d'action) sont en
 * haut du fichier et testés indépendamment de toute base.
 */

import type { OrderStatus, PaymentStatus, ShipmentStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isOrderStatus } from "@/domain/order";

// ─────────────────────────────────────────────────────────────────────
// Pagination — pur, sans base
// ─────────────────────────────────────────────────────────────────────

export const ORDERS_PAGE_SIZE = 20;

export type PageMeta = {
  page: number;
  pageCount: number;
  skip: number;
  take: number;
  total: number;
};

/** Ramène une valeur de query param à un numéro de page valide (>= 1). */
export function parsePage(raw: string | undefined): number {
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/** Lit un `?status=` et ne renvoie que les statuts connus. */
export function parseStatusFilter(raw: string | undefined): OrderStatus | null {
  if (!raw) return null;
  return isOrderStatus(raw) ? raw : null;
}

/**
 * Métadonnées de pagination : page effective (bornée), nombre de pages, offset.
 * Une page hors bornes retombe sur la dernière page réelle plutôt que sur une
 * liste vide inexplicable.
 */
export function paginationMeta(
  total: number,
  requestedPage: number,
  pageSize: number = ORDERS_PAGE_SIZE,
): PageMeta {
  const safeSize = pageSize > 0 ? Math.floor(pageSize) : ORDERS_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / safeSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  return { page, pageCount, skip: (page - 1) * safeSize, take: safeSize, total };
}

/** Même logique sur un tableau déjà chargé (utilisé par les tests). */
export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number = ORDERS_PAGE_SIZE,
): PageMeta & { items: T[] } {
  const meta = paginationMeta(items.length, requestedPage, pageSize);
  return { ...meta, items: items.slice(meta.skip, meta.skip + meta.take) };
}

/** URL de la liste des commandes pour un filtre + une page. */
export function buildOrdersHref(status: OrderStatus | null, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", `${page}`);
  const query = params.toString();
  return query ? `/admin/orders?${query}` : "/admin/orders";
}

// ─────────────────────────────────────────────────────────────────────
// Prédicats d'action
// ─────────────────────────────────────────────────────────────────────
//
// Les gardes elles-mêmes vivent dans `@/domain/order-actions` : ce module est
// importé par un composant client, il ne doit donc tirer aucune valeur de
// `@prisma/client`. On les ré-exporte ici pour que les pages serveur aient un
// seul point d'import.

export { canMarkPaid, canMarkShipped } from "@/domain/order-actions";

// ─────────────────────────────────────────────────────────────────────
// Types de lecture
// ─────────────────────────────────────────────────────────────────────

export type AdminOrderRow = {
  id: string;
  number: string;
  placedAt: Date;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  paymentProvider: string;
  customerName: string;
  customerEmail: string;
};

export type AdminOrderItem = {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceCents: number;
};

export type AdminOrderPayment = {
  id: string;
  provider: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
};

export type AdminOrderShipment = {
  id: string;
  carrier: string | null;
  trackingNo: string | null;
  status: ShipmentStatus;
  shippedAt: Date | null;
  deliveredAt: Date | null;
};

export type AdminOrderAddress = {
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
};

export type AdminOrderDetail = {
  id: string;
  number: string;
  status: OrderStatus;
  placedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  cancelledAt: Date | null;
  subtotalCents: number;
  discountCents: number;
  /** Code promo consommé (chantier E), `null` si aucun. */
  promoCode: string | null;
  shippingCents: number;
  totalCents: number;
  currency: string;
  paymentProvider: string;
  paymentRef: string | null;
  customer: { name: string; email: string; phone: string | null };
  address: AdminOrderAddress;
  items: AdminOrderItem[];
  payments: AdminOrderPayment[];
  shipments: AdminOrderShipment[];
};

export type StatusCounts = Record<OrderStatus, number>;

// ─────────────────────────────────────────────────────────────────────
// Requêtes
// ─────────────────────────────────────────────────────────────────────

const CUSTOMER_SELECT = {
  select: { firstName: true, lastName: true, email: true, phone: true },
} as const;

function displayName(customer: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const name = [customer.firstName, customer.lastName]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .trim();
  return name || customer.email;
}

export async function listAdminOrders(options: {
  status?: OrderStatus | null;
  page?: number;
}): Promise<{ rows: AdminOrderRow[]; meta: PageMeta }> {
  const status = options.status ?? null;
  const where = status ? { status } : {};

  const total = await prisma.order.count({ where });
  const meta = paginationMeta(total, options.page ?? 1);

  const orders = await prisma.order.findMany({
    where,
    orderBy: { placedAt: "desc" },
    skip: meta.skip,
    take: meta.take,
    select: {
      id: true,
      number: true,
      placedAt: true,
      totalCents: true,
      currency: true,
      status: true,
      paymentProvider: true,
      customer: CUSTOMER_SELECT,
    },
  });

  const rows: AdminOrderRow[] = orders.map((order) => ({
    id: order.id,
    number: order.number,
    placedAt: order.placedAt,
    totalCents: order.totalCents,
    currency: order.currency,
    status: order.status,
    paymentProvider: order.paymentProvider,
    customerName: displayName(order.customer),
    customerEmail: order.customer.email,
  }));

  return { rows, meta };
}

/** Nombre de commandes par statut — alimente les compteurs des filtres. */
export async function countOrdersByStatus(): Promise<StatusCounts> {
  const grouped = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const counts: StatusCounts = {
    PENDING_PAYMENT: 0,
    PAID: 0,
    PREPARING: 0,
    SHIPPED: 0,
    DELIVERED: 0,
    CANCELLED: 0,
    REFUNDED: 0,
  };
  for (const entry of grouped) {
    counts[entry.status] = entry._count._all;
  }
  return counts;
}

export async function getAdminOrderDetail(id: string): Promise<AdminOrderDetail | null> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: CUSTOMER_SELECT,
      address: true,
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { createdAt: "desc" } },
      shipments: { orderBy: { shippedAt: "desc" } },
      // Remise du code promo (chantier E) : le support doit pouvoir expliquer
      // au client d'où vient l'écart entre sous-total et total.
      redemption: { include: { promoCode: { select: { code: true } } } },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    cancelledAt: order.cancelledAt,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    promoCode: order.redemption?.promoCode.code ?? null,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    currency: order.currency,
    paymentProvider: order.paymentProvider,
    paymentRef: order.paymentRef,
    customer: {
      name: displayName(order.customer),
      email: order.customer.email,
      phone: order.customer.phone,
    },
    address: {
      line1: order.address.line1,
      line2: order.address.line2,
      city: order.address.city,
      postalCode: order.address.postalCode,
      country: order.address.country,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productNameSnapshot,
      variantName: item.variantNameSnapshot,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      providerRef: payment.providerRef,
      amountCents: payment.amountCents,
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt,
    })),
    shipments: order.shipments.map((shipment) => ({
      id: shipment.id,
      carrier: shipment.carrier,
      trackingNo: shipment.trackingNo,
      status: shipment.status,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
    })),
  };
}
