import { describe, expect, it } from "vitest";

import {
  ORDERS_PAGE_SIZE,
  buildOrdersHref,
  canMarkPaid,
  canMarkShipped,
  paginate,
  paginationMeta,
  parsePage,
  parseStatusFilter,
} from "@/server/admin-orders";

/**
 * Helpers purs de la liste des commandes — aucun accès base.
 * Les scénarios qui touchent Postgres (liste, détail, filtres, 401) vivent dans
 * tests/integration/admin-orders.test.ts.
 */

describe("parsePage", () => {
  it("ramène toute entrée invalide à la page 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-4")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("2.7")).toBe(2);
  });
});

describe("parseStatusFilter", () => {
  it("n'accepte que les statuts connus", () => {
    expect(parseStatusFilter("PAID")).toBe("PAID");
    expect(parseStatusFilter("REFUNDED")).toBe("REFUNDED");
    expect(parseStatusFilter("pas-un-statut")).toBeNull();
    expect(parseStatusFilter(undefined)).toBeNull();
  });
});

describe("paginationMeta", () => {
  it("borne la page demandée à la dernière page réelle", () => {
    const meta = paginationMeta(25, 99, 20);
    expect(meta.page).toBe(2);
    expect(meta.pageCount).toBe(2);
    expect(meta.skip).toBe(20);
    expect(meta.take).toBe(20);
    expect(meta.total).toBe(25);
  });

  it("renvoie toujours au moins une page, même sur un résultat vide", () => {
    const empty = paginationMeta(0, 1, 20);
    expect(empty.pageCount).toBe(1);
    expect(empty.page).toBe(1);
    expect(empty.skip).toBe(0);
  });

  it("utilise 20 par page par défaut", () => {
    expect(ORDERS_PAGE_SIZE).toBe(20);
    expect(paginationMeta(21, 1).pageCount).toBe(2);
  });
});

describe("paginate", () => {
  it("découpe un tableau et signale la page effective", () => {
    const items = Array.from({ length: 25 }, (_, i) => i + 1);
    const first = paginate(items, 1, ORDERS_PAGE_SIZE);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toBe(1);
    const second = paginate(items, 2, ORDERS_PAGE_SIZE);
    expect(second.items).toHaveLength(5);
    expect(second.items[0]).toBe(21);
    expect(paginate(items, 7, ORDERS_PAGE_SIZE).page).toBe(2);
  });
});

describe("buildOrdersHref", () => {
  it("n'expose la page que si elle n'est pas la première", () => {
    expect(buildOrdersHref(null, 1)).toBe("/admin/orders");
    expect(buildOrdersHref(null, 3)).toBe("/admin/orders?page=3");
    expect(buildOrdersHref("PAID", 1)).toBe("/admin/orders?status=PAID");
    expect(buildOrdersHref("PAID", 2)).toBe("/admin/orders?status=PAID&page=2");
  });
});

describe("prédicats d'action", () => {
  it("reflètent exactement les gardes des routes API", () => {
    expect(canMarkPaid({ status: "PENDING_PAYMENT", paymentProvider: "bank_transfer" })).toBe(true);
    expect(canMarkPaid({ status: "PENDING_PAYMENT", paymentProvider: "mock" })).toBe(false);
    expect(canMarkPaid({ status: "PAID", paymentProvider: "bank_transfer" })).toBe(false);
    expect(canMarkShipped({ status: "PAID" })).toBe(true);
    expect(canMarkShipped({ status: "PREPARING" })).toBe(true);
    expect(canMarkShipped({ status: "SHIPPED" })).toBe(false);
    expect(canMarkShipped({ status: "PENDING_PAYMENT" })).toBe(false);
  });
});
