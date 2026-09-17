import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockPaymentProvider } from "@/domain/payment/mock";
import { selectPaymentProvider } from "@/domain/payment/registry";

describe("MockPaymentProvider", () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it('a name = "mock"', () => {
    expect(provider.name).toBe("mock");
  });

  describe("createIntent", () => {
    it("renvoie un providerRef préfixé 'mock_' et un expiresAt ~+30 min", async () => {
      const before = Date.now();
      const result = await provider.createIntent({
        orderId: "order_test_1",
        amount: { amountCents: 4990, currency: "EUR" },
        customer: { email: "test@shop.local" },
        metadata: {},
        returnUrl: "https://shop.local/checkout/success",
      });
      const after = Date.now();
      expect(result.providerRef).toMatch(/^mock_[0-9a-z]+$/);
      expect(result.expiresAt).toBeInstanceOf(Date);
      const expMs = result.expiresAt!.getTime();
      expect(expMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
      expect(expMs).toBeLessThanOrEqual(after + 30 * 60 * 1000 + 1000);
    });

    it("génère des providerRef uniques", async () => {
      const a = await provider.createIntent({
        orderId: "x",
        amount: { amountCents: 0, currency: "EUR" },
        customer: { email: "x@x.x" },
        metadata: {},
        returnUrl: "",
      });
      const b = await provider.createIntent({
        orderId: "x",
        amount: { amountCents: 0, currency: "EUR" },
        customer: { email: "x@x.x" },
        metadata: {},
        returnUrl: "",
      });
      expect(a.providerRef).not.toBe(b.providerRef);
    });
  });

  describe("capture", () => {
    it('renvoie toujours status = "succeeded" en S2', async () => {
      const r = await provider.capture("mock_anything");
      expect(r.status).toBe("succeeded");
    });
  });

  describe("refund", () => {
    it("jette : non implémenté en S2", async () => {
      await expect(provider.refund("mock_x", undefined)).rejects.toThrow(/not implemented/i);
    });
  });

  describe("verifyWebhook", () => {
    it("jette : le mock n'utilise pas de webhook", async () => {
      await expect(
        provider.verifyWebhook({ headers: {}, rawBody: "{}" }),
      ).rejects.toThrow(/mock/i);
    });
  });
});

describe("selectPaymentProvider", () => {
  const originalEnv = process.env.PAYMENT_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = originalEnv;
  });

  it("renvoie un MockPaymentProvider quand PAYMENT_PROVIDER=mock", () => {
    process.env.PAYMENT_PROVIDER = "mock";
    const p = selectPaymentProvider();
    expect(p.name).toBe("mock");
  });

  it("renvoie MockPaymentProvider par défaut (env absente)", () => {
    delete process.env.PAYMENT_PROVIDER;
    const p = selectPaymentProvider();
    expect(p.name).toBe("mock");
  });

  it("jette si PAYMENT_PROVIDER a une valeur inconnue", () => {
    process.env.PAYMENT_PROVIDER = "carrier-pigeon";
    expect(() => selectPaymentProvider()).toThrow(/inconnu/i);
  });

  it("jette si PAYMENT_PROVIDER=stripe (S3 non implémenté)", () => {
    process.env.PAYMENT_PROVIDER = "stripe";
    expect(() => selectPaymentProvider()).toThrow(/S3/i);
  });
});
