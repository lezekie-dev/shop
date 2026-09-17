import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { canTransitionTo, generateOrderNumber } from "@/domain/order";

describe("canTransitionTo", () => {
  it("PENDING_PAYMENT → PAID est autorisé (paiement confirmé)", () => {
    expect(canTransitionTo(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID)).toBe(true);
  });

  it("PENDING_PAYMENT → CANCELLED est autorisé (annulation client avant paiement)", () => {
    expect(canTransitionTo(OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED)).toBe(true);
  });

  it("PAID → PREPARING est autorisé", () => {
    expect(canTransitionTo(OrderStatus.PAID, OrderStatus.PREPARING)).toBe(true);
  });

  it("PAID → REFUNDED est autorisé", () => {
    expect(canTransitionTo(OrderStatus.PAID, OrderStatus.REFUNDED)).toBe(true);
  });

  it("PREPARING → SHIPPED est autorisé", () => {
    expect(canTransitionTo(OrderStatus.PREPARING, OrderStatus.SHIPPED)).toBe(true);
  });

  it("SHIPPED → DELIVERED est autorisé", () => {
    expect(canTransitionTo(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
  });

  it("DELIVERED → REFUNDED est autorisé (retour après livraison)", () => {
    expect(canTransitionTo(OrderStatus.DELIVERED, OrderStatus.REFUNDED)).toBe(true);
  });

  it("ne permet PAS de transition depuis un état terminal", () => {
    // CANCELLED : terminal
    expect(canTransitionTo(OrderStatus.CANCELLED, OrderStatus.PAID)).toBe(false);
    expect(canTransitionTo(OrderStatus.CANCELLED, OrderStatus.PREPARING)).toBe(false);
    // REFUNDED : terminal
    expect(canTransitionTo(OrderStatus.REFUNDED, OrderStatus.PAID)).toBe(false);
  });

  it("ne permet PAS de revenir en arrière", () => {
    expect(canTransitionTo(OrderStatus.PAID, OrderStatus.PENDING_PAYMENT)).toBe(false);
    expect(canTransitionTo(OrderStatus.SHIPPED, OrderStatus.PREPARING)).toBe(false);
    expect(canTransitionTo(OrderStatus.DELIVERED, OrderStatus.SHIPPED)).toBe(false);
  });

  it("ne permet PAS de sauter une étape obligatoire", () => {
    expect(canTransitionTo(OrderStatus.PENDING_PAYMENT, OrderStatus.SHIPPED)).toBe(false);
    expect(canTransitionTo(OrderStatus.PAID, OrderStatus.SHIPPED)).toBe(false);
    expect(canTransitionTo(OrderStatus.PAID, OrderStatus.DELIVERED)).toBe(false);
  });

  it("transition vers soi-même interdite", () => {
    for (const s of Object.values(OrderStatus)) {
      expect(canTransitionTo(s, s)).toBe(false);
    }
  });

  it("CANCELLED accessible uniquement depuis PENDING_PAYMENT ou PAID (pas plus tard)", () => {
    expect(canTransitionTo(OrderStatus.PREPARING, OrderStatus.CANCELLED)).toBe(false);
    expect(canTransitionTo(OrderStatus.SHIPPED, OrderStatus.CANCELLED)).toBe(false);
  });
});

describe("generateOrderNumber", () => {
  it('formate ORD-2026-000001 à partir de seq=1 et year=2026', () => {
    expect(generateOrderNumber(1, 2026)).toBe("ORD-2026-000001");
  });

  it("zero-pad la séquence sur 6 chiffres", () => {
    expect(generateOrderNumber(42, 2026)).toBe("ORD-2026-000042");
    expect(generateOrderNumber(999_999, 2026)).toBe("ORD-2026-999999");
  });

  it("utilise new Date().getFullYear() par défaut", () => {
    const out = generateOrderNumber(7);
    const year = new Date().getFullYear();
    expect(out).toBe(`ORD-${year}-000007`);
  });

  it("rejette une séquence <= 0", () => {
    expect(() => generateOrderNumber(0)).toThrow();
    expect(() => generateOrderNumber(-3)).toThrow();
  });

  it("rejette une séquence non entière", () => {
    expect(() => generateOrderNumber(1.5)).toThrow();
    expect(() => generateOrderNumber(Number.NaN)).toThrow();
  });
});
