import { afterEach, describe, expect, it } from "vitest";

import {
  KNOWN_PROVIDERS,
  STRIPE_NOT_CONFIGURED,
  listAvailableProviders,
  selectPaymentProvider,
} from "@/domain/payment/registry";

describe("selectPaymentProvider (par nom explicite)", () => {
  it('"mock" → MockPaymentProvider', () => {
    expect(selectPaymentProvider("mock").name).toBe("mock");
  });

  it('"mobile_money" → MobileMoneyPaymentProvider', () => {
    expect(selectPaymentProvider("mobile_money").name).toBe("mobile_money");
  });

  it('"bank_transfer" → BankTransferPaymentProvider', () => {
    expect(selectPaymentProvider("bank_transfer").name).toBe("bank_transfer");
  });

  it('"stripe" jette un message explicite et actionnable', () => {
    expect(() => selectPaymentProvider("stripe")).toThrow(STRIPE_NOT_CONFIGURED);
    expect(() => selectPaymentProvider("stripe")).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => selectPaymentProvider("stripe")).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => selectPaymentProvider("stripe")).toThrow(/src\/domain\/payment\/stripe\.ts/);
    expect(() => selectPaymentProvider("stripe")).toThrow(/mock/i);
  });

  it("jette sur un nom inconnu, en listant les valeurs attendues", () => {
    expect(() => selectPaymentProvider("paypal")).toThrow(/inconnu/i);
    expect(() => selectPaymentProvider("paypal")).toThrow(/bank_transfer/);
  });
});

describe("selectPaymentProvider (depuis l'env)", () => {
  const original = process.env.PAYMENT_PROVIDER;

  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = original;
  });

  it("défaut = mock quand PAYMENT_PROVIDER est absente", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(selectPaymentProvider().name).toBe("mock");
  });

  it("suit PAYMENT_PROVIDER=mobile_money", () => {
    process.env.PAYMENT_PROVIDER = "mobile_money";
    expect(selectPaymentProvider().name).toBe("mobile_money");
  });

  it("suit PAYMENT_PROVIDER=bank_transfer", () => {
    process.env.PAYMENT_PROVIDER = "bank_transfer";
    expect(selectPaymentProvider().name).toBe("bank_transfer");
  });

  it("l'argument explicite prime sur l'env", () => {
    process.env.PAYMENT_PROVIDER = "mobile_money";
    expect(selectPaymentProvider("mock").name).toBe("mock");
  });
});

describe("listAvailableProviders", () => {
  const list = listAvailableProviders();

  it("renvoie les 4 providers connus, dans un ordre stable", () => {
    expect(list.map((p) => p.name)).toEqual([...KNOWN_PROVIDERS]);
  });

  it("chaque entrée a un label non vide", () => {
    for (const p of list) {
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("mock / mobile_money / bank_transfer sont disponibles sans aucune config", () => {
    const byName = new Map(list.map((p) => [p.name, p]));
    for (const name of ["mock", "mobile_money", "bank_transfer"] as const) {
      expect(byName.get(name)?.available).toBe(true);
      expect(byName.get(name)?.reason).toBeUndefined();
    }
  });

  it("stripe est indisponible, avec la raison complète", () => {
    const stripe = list.find((p) => p.name === "stripe");
    expect(stripe?.available).toBe(false);
    expect(stripe?.reason).toBe(STRIPE_NOT_CONFIGURED);
  });

  it("cohérence : available:true ⇔ selectPaymentProvider(name) ne jette pas", () => {
    for (const p of list) {
      const mustThrow = !p.available;
      let threw = false;
      try {
        selectPaymentProvider(p.name);
      } catch {
        threw = true;
      }
      expect(threw).toBe(mustThrow);
    }
  });
});
