/**
 * Statistiques du back-office.
 *
 * ─── RÈGLE DE CONSTRUCTION ────────────────────────────────────────────
 * Toute la logique métier de ce fichier est PUR : des tableaux et des dates
 * entrent, des nombres sortent. Aucune fonction de calcul ne touche Prisma.
 * Les requêtes vivent uniquement dans `loadDashboardData()` en bas de fichier.
 * C'est ce qui rend `tests/unit/admin-stats.test.ts` possible sans base.
 *
 * ─── DÉCISIONS MÉTIER ENCODÉES ICI ────────────────────────────────────
 * 1. Le chiffre d'affaires ne compte QUE les commandes réellement encaissées
 *    (PAID / PREPARING / SHIPPED / DELIVERED). Une commande PENDING_PAYMENT
 *    n'est pas du CA, et une commande CANCELLED ou REFUNDED sort du CA —
 *    sinon le marchand pilote sur des chiffres qu'il n'a jamais encaissés.
 * 2. « Commandes à traiter » = tout ce qui attend une action du marchand :
 *    PENDING_PAYMENT (relance / validation virement), PAID et PREPARING
 *    (à expédier). SHIPPED et au-delà sont sortis de la file.
 * 3. « Panier moyen » = CA / nombre de commandes encaissées. Zéro commande →
 *    zéro, jamais NaN.
 * 4. La tendance compare la fenêtre courante (30 j) à la fenêtre précédente
 *    (les 30 j d'avant). Sans base de comparaison (`previous === 0`), on
 *    renvoie `pct: null` plutôt qu'un pourcentage infini ou trompeur.
 */

import type { OrderStatus } from "@prisma/client";

import { prisma } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────

/** Fenêtre par défaut des métriques (jours). */
export const METRICS_WINDOW_DAYS = 30;
/** Points du mini-graphe (jours). */
export const SPARKLINE_DAYS = 7;
/** Nombre de commandes récentes affichées sur le tableau de bord. */
export const RECENT_ORDERS_LIMIT = 8;
/** Seuil d'alerte stock : disponible (quantity - reserved) <= 5. */
export const LOW_STOCK_THRESHOLD = 5;

/** Statuts qui pèsent dans le chiffre d'affaires (encaissé). */
export const REVENUE_STATUSES: readonly OrderStatus[] = [
  "PAID",
  "PREPARING",
  "SHIPPED",
  "DELIVERED",
];

/** Statuts qui attendent une action du marchand. */
export const TO_PROCESS_STATUSES: readonly OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "PREPARING",
];

export function isRevenueBearing(status: OrderStatus): boolean {
  return REVENUE_STATUSES.includes(status);
}

export function isToProcess(status: OrderStatus): boolean {
  return TO_PROCESS_STATUSES.includes(status);
}

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/** Vue minimale d'une commande suffisante pour tous les calculs. */
export type OrderPoint = {
  totalCents: number;
  placedAt: Date;
  status: OrderStatus;
  paymentProvider: string;
};

export type PeriodMetrics = {
  revenueCents: number;
  orderCount: number;
  averageBasketCents: number;
};

export type TrendDirection = "up" | "down" | "flat";

export type Trend = {
  pct: number | null;
  direction: TrendDirection;
};

export type DailyBucket = {
  dayStart: Date;
  revenueCents: number;
  orderCount: number;
  toProcessCount: number;
};

export type PaymentShare = {
  provider: string;
  orderCount: number;
  totalCents: number;
  /** Part du CA encaissé sur la fenêtre, entre 0 et 1. */
  share: number;
};

export type StockRow = {
  variantId: string;
  sku: string;
  variantName: string;
  productName: string;
  productSlug: string;
  quantity: number;
  reserved: number;
};

export type StockAlert = StockRow & {
  available: number;
  /** true = rupture : aucune unité disponible. */
  critical: boolean;
};

/** Seuil en dessous duquel une baisse n'est pas une baisse mais du bruit. */
const FLAT_TOLERANCE_PCT = 0.05;

// ─────────────────────────────────────────────────────────────────────
// Fenêtres temporelles
// ─────────────────────────────────────────────────────────────────────

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type WindowBounds = {
  currentFrom: Date;
  currentTo: Date;
  previousFrom: Date;
  previousTo: Date;
};

/** Bornes [from, to) de la fenêtre courante et de la fenêtre précédente. */
export function windowBounds(days: number = METRICS_WINDOW_DAYS, now: Date = new Date()): WindowBounds {
  const currentTo = now;
  const currentFrom = addDays(now, -days);
  return {
    currentFrom,
    currentTo,
    previousFrom: addDays(now, -days * 2),
    previousTo: currentFrom,
  };
}

/** Commandes dont `placedAt` tombe dans [from, to). */
export function ordersInWindow(
  orders: readonly OrderPoint[],
  from: Date,
  to: Date,
): OrderPoint[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return orders.filter((o) => {
    const t = o.placedAt.getTime();
    return t >= fromMs && t < toMs;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Métriques de période
// ─────────────────────────────────────────────────────────────────────

export function revenueCents(orders: readonly OrderPoint[]): number {
  return orders.reduce((acc, o) => (isRevenueBearing(o.status) ? acc + o.totalCents : acc), 0);
}

export function paidOrderCount(orders: readonly OrderPoint[]): number {
  return orders.reduce((acc, o) => (isRevenueBearing(o.status) ? acc + 1 : acc), 0);
}

/** CA, nombre de commandes encaissées, et panier moyen — en une passe. */
export function periodMetrics(orders: readonly OrderPoint[]): PeriodMetrics {
  const revenue = revenueCents(orders);
  const count = paidOrderCount(orders);
  return {
    revenueCents: revenue,
    orderCount: count,
    averageBasketCents: count > 0 ? Math.round(revenue / count) : 0,
  };
}

/** Nombre de commandes en attente d'une action du marchand. */
export function ordersToProcessCount(orders: readonly OrderPoint[]): number {
  return orders.reduce((acc, o) => (isToProcess(o.status) ? acc + 1 : acc), 0);
}

/**
 * Variation en % de `current` par rapport à `previous`.
 *
 * `pct: null` = pas de base de comparaison (période précédente vide) ; on ne
 * prétend pas à une progression de +∞ %.
 */
export function percentageChange(current: number, previous: number): Trend {
  if (previous === 0) {
    return { pct: null, direction: current > 0 ? "up" : "flat" };
  }
  const pct = ((current - previous) / previous) * 100;
  if (pct > FLAT_TOLERANCE_PCT) return { pct, direction: "up" };
  if (pct < -FLAT_TOLERANCE_PCT) return { pct, direction: "down" };
  return { pct, direction: "flat" };
}

// ─────────────────────────────────────────────────────────────────────
// Séries journalières (mini-graphes)
// ─────────────────────────────────────────────────────────────────────

/**
 * Série de `days` journées consécutives se terminant au jour de `now`.
 *
 * Une commande non encaissée compte dans `toProcessCount` mais jamais dans
 * `revenueCents` / `orderCount` — les trois courbes restent cohérentes avec
 * les métriques de période.
 */
export function dailySeries(
  orders: readonly OrderPoint[],
  days: number = SPARKLINE_DAYS,
  now: Date = new Date(),
): DailyBucket[] {
  const today = startOfDay(now);
  const buckets: DailyBucket[] = [];
  const indexByKey = new Map<string, number>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayStart = addDays(today, -offset);
    indexByKey.set(dayKey(dayStart), buckets.length);
    buckets.push({ dayStart, revenueCents: 0, orderCount: 0, toProcessCount: 0 });
  }

  for (const order of orders) {
    const at = indexByKey.get(dayKey(order.placedAt));
    if (at === undefined) continue;
    const bucket = buckets[at];
    if (!bucket) continue;
    if (isRevenueBearing(order.status)) {
      bucket.revenueCents += order.totalCents;
      bucket.orderCount += 1;
    }
    if (isToProcess(order.status)) {
      bucket.toProcessCount += 1;
    }
  }

  return buckets;
}

// ─────────────────────────────────────────────────────────────────────
// Répartition par méthode de paiement
// ─────────────────────────────────────────────────────────────────────

/**
 * Répartition du CA encaissé par provider, triée du plus gros au plus petit.
 * `share` est une fraction (0..1) et vaut 0 quand aucun encaissement.
 */
export function paymentBreakdown(orders: readonly OrderPoint[]): PaymentShare[] {
  const byProvider = new Map<string, { orderCount: number; totalCents: number }>();

  for (const order of orders) {
    if (!isRevenueBearing(order.status)) continue;
    const entry = byProvider.get(order.paymentProvider) ?? { orderCount: 0, totalCents: 0 };
    entry.orderCount += 1;
    entry.totalCents += order.totalCents;
    byProvider.set(order.paymentProvider, entry);
  }

  const total = [...byProvider.values()].reduce((acc, e) => acc + e.totalCents, 0);

  return [...byProvider.entries()]
    .map(([provider, entry]) => ({
      provider,
      orderCount: entry.orderCount,
      totalCents: entry.totalCents,
      share: total > 0 ? entry.totalCents / total : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

// ─────────────────────────────────────────────────────────────────────
// Alertes stock
// ─────────────────────────────────────────────────────────────────────

/**
 * Variantes à réapprovisionner : disponible = quantity - reserved <= seuil.
 * Tri par urgence : ruptures d'abord, puis les plus faibles disponibles, puis
 * par quantité totale croissante (le SKU le plus contraint en tête).
 */
export function stockAlerts(
  rows: readonly StockRow[],
  threshold: number = LOW_STOCK_THRESHOLD,
): StockAlert[] {
  return rows
    .map((row) => {
      const available = row.quantity - row.reserved;
      return { ...row, available, critical: available <= 0 };
    })
    .filter((row) => row.available <= threshold)
    .sort((a, b) => {
      if (a.critical !== b.critical) return a.critical ? -1 : 1;
      if (a.available !== b.available) return a.available - b.available;
      return a.quantity - b.quantity;
    });
}

// ─────────────────────────────────────────────────────────────────────
// Chargement (seul endroit qui touche Prisma)
// ─────────────────────────────────────────────────────────────────────

export type RecentOrder = {
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

export type DashboardData = {
  windowDays: number;
  currency: string;
  hasAnyOrder: boolean;
  totalOrderCount: number;
  revenue: { current: PeriodMetrics; previous: PeriodMetrics; trend: Trend };
  orders: { current: number; previous: number; trend: Trend };
  basket: { current: number; previous: number; trend: Trend };
  toProcess: { current: number; previous: number; trend: Trend; total: number };
  series: DailyBucket[];
  recentOrders: RecentOrder[];
  payments: PaymentShare[];
  paymentsTotalCents: number;
  stockAlerts: StockAlert[];
};

export async function loadDashboardData(now: Date = new Date()): Promise<DashboardData> {
  const bounds = windowBounds(METRICS_WINDOW_DAYS, now);

  const [windowOrders, recentRows, totalOrderCount, toProcessTotal, stockRows] = await Promise.all([
    prisma.order.findMany({
      where: { placedAt: { gte: bounds.previousFrom, lt: bounds.currentTo } },
      select: {
        totalCents: true,
        placedAt: true,
        status: true,
        paymentProvider: true,
      },
    }),
    prisma.order.findMany({
      orderBy: { placedAt: "desc" },
      take: RECENT_ORDERS_LIMIT,
      select: {
        id: true,
        number: true,
        placedAt: true,
        totalCents: true,
        currency: true,
        status: true,
        paymentProvider: true,
        customer: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.order.count(),
    prisma.order.count({ where: { status: { in: [...TO_PROCESS_STATUSES] } } }),
    // Le catalogue MVP fait quelques dizaines de variantes : on lit tout et on
    // filtre sur `quantity - reserved` en pur (Prisma ne compare pas 2 colonnes).
    prisma.stock.findMany({
      select: {
        variantId: true,
        quantity: true,
        reserved: true,
        variant: {
          select: {
            sku: true,
            name: true,
            product: { select: { name: true, slug: true } },
          },
        },
      },
    }),
  ]);

  const points: OrderPoint[] = windowOrders.map((o) => ({
    totalCents: o.totalCents,
    placedAt: o.placedAt,
    status: o.status,
    paymentProvider: o.paymentProvider,
  }));

  const currentOrders = ordersInWindow(points, bounds.currentFrom, bounds.currentTo);
  const previousOrders = ordersInWindow(points, bounds.previousFrom, bounds.previousTo);

  const currentMetrics = periodMetrics(currentOrders);
  const previousMetrics = periodMetrics(previousOrders);

  const currentToProcess = ordersToProcessCount(currentOrders);
  const previousToProcess = ordersToProcessCount(previousOrders);

  const recentOrders: RecentOrder[] = recentRows.map((o) => {
    const name = [o.customer.firstName, o.customer.lastName]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .trim();
    return {
      id: o.id,
      number: o.number,
      placedAt: o.placedAt,
      totalCents: o.totalCents,
      currency: o.currency,
      status: o.status,
      paymentProvider: o.paymentProvider,
      customerName: name || o.customer.email,
      customerEmail: o.customer.email,
    };
  });

  const payments = paymentBreakdown(currentOrders);

  return {
    windowDays: METRICS_WINDOW_DAYS,
    currency: recentOrders[0]?.currency ?? process.env.SHOP_CURRENCY ?? "EUR",
    hasAnyOrder: totalOrderCount > 0,
    totalOrderCount,
    revenue: {
      current: currentMetrics,
      previous: previousMetrics,
      trend: percentageChange(currentMetrics.revenueCents, previousMetrics.revenueCents),
    },
    orders: {
      current: currentMetrics.orderCount,
      previous: previousMetrics.orderCount,
      trend: percentageChange(currentMetrics.orderCount, previousMetrics.orderCount),
    },
    basket: {
      current: currentMetrics.averageBasketCents,
      previous: previousMetrics.averageBasketCents,
      trend: percentageChange(
        currentMetrics.averageBasketCents,
        previousMetrics.averageBasketCents,
      ),
    },
    toProcess: {
      current: currentToProcess,
      previous: previousToProcess,
      trend: percentageChange(currentToProcess, previousToProcess),
      total: toProcessTotal,
    },
    series: dailySeries(points, SPARKLINE_DAYS, now),
    recentOrders,
    payments,
    paymentsTotalCents: payments.reduce((acc, p) => acc + p.totalCents, 0),
    stockAlerts: stockAlerts(
      stockRows.map((s) => ({
        variantId: s.variantId,
        sku: s.variant.sku,
        variantName: s.variant.name,
        productName: s.variant.product.name,
        productSlug: s.variant.product.slug,
        quantity: s.quantity,
        reserved: s.reserved,
      })),
    ),
  };
}
