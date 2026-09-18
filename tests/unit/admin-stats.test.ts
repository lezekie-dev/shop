import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@prisma/client";

import {
  LOW_STOCK_THRESHOLD,
  METRICS_WINDOW_DAYS,
  SPARKLINE_DAYS,
  addDays,
  dailySeries,
  isRevenueBearing,
  isToProcess,
  ordersInWindow,
  ordersToProcessCount,
  paidOrderCount,
  paymentBreakdown,
  percentageChange,
  periodMetrics,
  revenueCents,
  startOfDay,
  stockAlerts,
  windowBounds,
  type OrderPoint,
  type StockRow,
} from "@/server/admin-stats";

// ─────────────────────────────────────────────────────────────────────
// Jeux de données fixes
// ─────────────────────────────────────────────────────────────────────

const NOW = new Date(2026, 8, 18, 14, 30, 0); // 18 septembre 2026, 14h30 (heure locale)

function day(offset: number, hour = 10): Date {
  const d = addDays(startOfDay(NOW), offset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function point(over: Partial<OrderPoint> & { placedAt: Date }): OrderPoint {
  return {
    totalCents: 1_000,
    status: "PAID" as OrderStatus,
    paymentProvider: "mock",
    ...over,
  };
}

function stockRow(over: Partial<StockRow> & { variantId: string }): StockRow {
  return {
    sku: `SKU-${over.variantId}`,
    variantName: "Taille M",
    productName: "T-shirt",
    productSlug: "t-shirt",
    quantity: 10,
    reserved: 0,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Prédicats de statut
// ─────────────────────────────────────────────────────────────────────

describe("isRevenueBearing / isToProcess", () => {
  it("ne compte dans le CA que les commandes réellement encaissées", () => {
    expect(isRevenueBearing("PAID")).toBe(true);
    expect(isRevenueBearing("PREPARING")).toBe(true);
    expect(isRevenueBearing("SHIPPED")).toBe(true);
    expect(isRevenueBearing("DELIVERED")).toBe(true);
    expect(isRevenueBearing("PENDING_PAYMENT")).toBe(false);
    expect(isRevenueBearing("CANCELLED")).toBe(false);
    expect(isRevenueBearing("REFUNDED")).toBe(false);
  });

  it("considère comme « à traiter » ce qui attend une action du marchand", () => {
    expect(isToProcess("PENDING_PAYMENT")).toBe(true);
    expect(isToProcess("PAID")).toBe(true);
    expect(isToProcess("PREPARING")).toBe(true);
    expect(isToProcess("SHIPPED")).toBe(false);
    expect(isToProcess("DELIVERED")).toBe(false);
    expect(isToProcess("CANCELLED")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Fenêtres
// ─────────────────────────────────────────────────────────────────────

describe("windowBounds", () => {
  it("produit une fenêtre courante et une fenêtre précédente jointives", () => {
    const b = windowBounds(METRICS_WINDOW_DAYS, NOW);
    expect(b.currentTo.getTime()).toBe(NOW.getTime());
    expect(b.currentFrom.getTime()).toBe(addDays(NOW, -30).getTime());
    expect(b.previousTo.getTime()).toBe(b.currentFrom.getTime());
    expect(b.previousFrom.getTime()).toBe(addDays(NOW, -60).getTime());
  });
});

describe("ordersInWindow", () => {
  it("respecte les bornes [from, to)", () => {
    const from = day(-30);
    const to = NOW;
    const inside = point({ placedAt: day(-10) });
    const atFrom = point({ placedAt: new Date(from.getTime()) });
    const atTo = point({ placedAt: new Date(to.getTime()) });
    const before = point({ placedAt: day(-31) });

    const kept = ordersInWindow([inside, atFrom, atTo, before], from, to);
    expect(kept).toHaveLength(2);
    expect(kept).toContain(inside);
    expect(kept).toContain(atFrom);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Métriques de période
// ─────────────────────────────────────────────────────────────────────

describe("periodMetrics", () => {
  const orders: OrderPoint[] = [
    point({ placedAt: day(-1), totalCents: 2_000, status: "PAID" }),
    point({ placedAt: day(-2), totalCents: 3_000, status: "SHIPPED" }),
    point({ placedAt: day(-3), totalCents: 9_999, status: "PENDING_PAYMENT" }),
    point({ placedAt: day(-4), totalCents: 7_777, status: "CANCELLED" }),
    point({ placedAt: day(-5), totalCents: 1_500, status: "REFUNDED" }),
  ];

  it("ignore les commandes non encaissées dans le CA et le compteur", () => {
    expect(revenueCents(orders)).toBe(5_000);
    expect(paidOrderCount(orders)).toBe(2);
  });

  it("calcule le panier moyen sur les seules commandes encaissées", () => {
    const m = periodMetrics(orders);
    expect(m.revenueCents).toBe(5_000);
    expect(m.orderCount).toBe(2);
    expect(m.averageBasketCents).toBe(2_500);
  });

  it("arrondit le panier moyen à l'entier de centimes", () => {
    const m = periodMetrics([
      point({ placedAt: day(-1), totalCents: 1_000 }),
      point({ placedAt: day(-2), totalCents: 1_001 }),
      point({ placedAt: day(-3), totalCents: 1_000 }),
    ]);
    expect(m.revenueCents).toBe(3_001);
    expect(m.averageBasketCents).toBe(1_000); // 1000.33 → 1000
  });

  it("renvoie des zéros (jamais NaN) sans commande", () => {
    const m = periodMetrics([]);
    expect(m).toEqual({ revenueCents: 0, orderCount: 0, averageBasketCents: 0 });
    expect(Number.isNaN(m.averageBasketCents)).toBe(false);
  });
});

describe("ordersToProcessCount", () => {
  it("compte PENDING_PAYMENT + PAID + PREPARING, rien d'autre", () => {
    const orders: OrderPoint[] = [
      point({ placedAt: day(-1), status: "PENDING_PAYMENT" }),
      point({ placedAt: day(-2), status: "PAID" }),
      point({ placedAt: day(-3), status: "PREPARING" }),
      point({ placedAt: day(-4), status: "SHIPPED" }),
      point({ placedAt: day(-5), status: "DELIVERED" }),
      point({ placedAt: day(-6), status: "CANCELLED" }),
      point({ placedAt: day(-7), status: "REFUNDED" }),
    ];
    expect(ordersToProcessCount(orders)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tendance
// ─────────────────────────────────────────────────────────────────────

describe("percentageChange", () => {
  it("détecte une hausse", () => {
    const t = percentageChange(150, 100);
    expect(t.direction).toBe("up");
    expect(t.pct).toBeCloseTo(50, 5);
  });

  it("détecte une baisse", () => {
    const t = percentageChange(75, 100);
    expect(t.direction).toBe("down");
    expect(t.pct).toBeCloseTo(-25, 5);
  });

  it("considère comme stable une variation sous le seuil de bruit", () => {
    const t = percentageChange(10_000, 10_000);
    expect(t.direction).toBe("flat");
    expect(t.pct).toBe(0);
  });

  it("ne prétend pas à +∞ % quand la période précédente est vide", () => {
    expect(percentageChange(5_000, 0)).toEqual({ pct: null, direction: "up" });
    expect(percentageChange(0, 0)).toEqual({ pct: null, direction: "flat" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Séries journalières
// ─────────────────────────────────────────────────────────────────────

describe("dailySeries", () => {
  it("produit exactement `days` journées, de la plus ancienne à aujourd'hui", () => {
    const series = dailySeries([], SPARKLINE_DAYS, NOW);
    expect(series).toHaveLength(7);
    expect(series[0]?.dayStart.getTime()).toBe(addDays(startOfDay(NOW), -6).getTime());
    expect(series[6]?.dayStart.getTime()).toBe(startOfDay(NOW).getTime());
  });

  it("répartit CA, commandes payées et commandes à traiter par journée", () => {
    const series = dailySeries(
      [
        point({ placedAt: day(0, 9), totalCents: 2_000, status: "PAID" }),
        point({ placedAt: day(0, 11), totalCents: 3_000, status: "SHIPPED" }),
        point({ placedAt: day(0, 12), totalCents: 9_999, status: "PENDING_PAYMENT" }),
        point({ placedAt: day(-2), totalCents: 1_000, status: "DELIVERED" }),
        point({ placedAt: day(-9), totalCents: 5_000, status: "PAID" }), // hors fenêtre
      ],
      SPARKLINE_DAYS,
      NOW,
    );

    const today = series[6];
    expect(today?.revenueCents).toBe(5_000);
    expect(today?.orderCount).toBe(2);
    // PAID (à expédier) + PENDING_PAYMENT (à encaisser) ; SHIPPED est sorti de la file.
    expect(today?.toProcessCount).toBe(2);

    const twoDaysAgo = series[4];
    expect(twoDaysAgo?.revenueCents).toBe(1_000);
    expect(twoDaysAgo?.orderCount).toBe(1);
    expect(twoDaysAgo?.toProcessCount).toBe(0);

    // La commande hors fenêtre n'apparaît nulle part.
    const total = series.reduce((acc, b) => acc + b.revenueCents, 0);
    expect(total).toBe(6_000);
  });

  it("ne compte pas une commande annulée dans le CA mais la compte dans le flux du jour", () => {
    const series = dailySeries(
      [point({ placedAt: day(0), totalCents: 4_000, status: "CANCELLED" })],
      SPARKLINE_DAYS,
      NOW,
    );
    expect(series[6]?.revenueCents).toBe(0);
    expect(series[6]?.orderCount).toBe(0);
    expect(series[6]?.toProcessCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Répartition des paiements
// ─────────────────────────────────────────────────────────────────────

describe("paymentBreakdown", () => {
  it("agrège par provider, trie par CA décroissant et somme à 1", () => {
    const orders: OrderPoint[] = [
      point({ placedAt: day(-1), totalCents: 6_000, paymentProvider: "mobile_money" }),
      point({ placedAt: day(-2), totalCents: 2_000, paymentProvider: "bank_transfer" }),
      point({ placedAt: day(-3), totalCents: 2_000, paymentProvider: "mobile_money" }),
      point({ placedAt: day(-4), totalCents: 100, paymentProvider: "mock", status: "PENDING_PAYMENT" }),
    ];

    const breakdown = paymentBreakdown(orders);
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]?.provider).toBe("mobile_money");
    expect(breakdown[0]?.totalCents).toBe(8_000);
    expect(breakdown[0]?.orderCount).toBe(2);
    expect(breakdown[0]?.share).toBeCloseTo(0.8, 5);
    expect(breakdown[1]?.provider).toBe("bank_transfer");
    expect(breakdown[1]?.share).toBeCloseTo(0.2, 5);

    const sum = breakdown.reduce((acc, p) => acc + p.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("renvoie une liste vide (pas de division par zéro) sans encaissement", () => {
    expect(paymentBreakdown([])).toEqual([]);
    expect(paymentBreakdown([point({ placedAt: day(-1), status: "PENDING_PAYMENT" })])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Alertes stock
// ─────────────────────────────────────────────────────────────────────

describe("stockAlerts", () => {
  it("ne garde que les variantes sous le seuil, disponible = quantity - reserved", () => {
    const alerts = stockAlerts([
      stockRow({ variantId: "a", quantity: 30, reserved: 0 }), // 30 → exclu
      stockRow({ variantId: "b", quantity: 8, reserved: 3 }), //  5 → seuil inclus
      stockRow({ variantId: "c", quantity: 10, reserved: 9 }), //  1
      stockRow({ variantId: "d", quantity: 5, reserved: 5 }), //  0 → rupture
    ]);

    expect(alerts.map((a) => a.variantId)).toEqual(["d", "c", "b"]);
    expect(alerts[0]?.available).toBe(0);
    expect(alerts[0]?.critical).toBe(true);
    expect(alerts[2]?.available).toBe(5);
    expect(alerts[2]?.critical).toBe(false);
  });

  it("trie les non-ruptures par disponibilité croissante puis quantité croissante", () => {
    const alerts = stockAlerts([
      stockRow({ variantId: "x", quantity: 5, reserved: 1 }), // 4
      stockRow({ variantId: "y", quantity: 3, reserved: 0 }), // 3
      stockRow({ variantId: "z", quantity: 50, reserved: 48 }), // 2
    ]);
    expect(alerts.map((a) => a.variantId)).toEqual(["z", "y", "x"]);
  });

  it("utilise le seuil par défaut de 5 et reste vide au-dessus", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(5);
    expect(stockAlerts([stockRow({ variantId: "ok", quantity: 6 })])).toEqual([]);
    expect(stockAlerts([stockRow({ variantId: "low", quantity: 5 })])).toHaveLength(1);
  });

  it("accepte un seuil explicite", () => {
    const alerts = stockAlerts([stockRow({ variantId: "a", quantity: 20 })], 25);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.available).toBe(20);
  });
});
