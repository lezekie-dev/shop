import { beforeEach, describe, expect, it } from "vitest";
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider } from "@/domain/payment/mock";

const baseInput = {
  orderId: "order_test_1",
  amount: { amountCents: 4990, currency: "EUR" },
  customer: { email: "test@shop.local" },
  returnUrl: "https://shop.local/checkout/success",
};

describe("MockPaymentProvider", () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it('a name = "mock"', () => {
    expect(provider.name).toBe("mock");
  });

  describe("createIntent — scénario 'success' (défaut)", () => {
    it("renvoie un providerRef préfixé 'mock_' et un expiresAt ~+30 min", async () => {
      const before = Date.now();
      const result = await provider.createIntent({ ...baseInput, metadata: {} });
      const after = Date.now();
      expect(result.providerRef).toMatch(/^mock_[0-9a-z]+$/);
      expect(result.expiresAt).toBeInstanceOf(Date);
      const expMs = result.expiresAt!.getTime();
      expect(expMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
      expect(expMs).toBeLessThanOrEqual(after + 30 * 60 * 1000 + 1000);
    });

    it("capture d'une ref success → succeeded", async () => {
      const { providerRef } = await provider.createIntent({ ...baseInput, metadata: {} });
      await expect(provider.capture(providerRef)).resolves.toEqual({ status: "succeeded" });
    });

    it("génère des providerRef uniques", async () => {
      const a = await provider.createIntent({ ...baseInput, metadata: {} });
      const b = await provider.createIntent({ ...baseInput, metadata: {} });
      expect(a.providerRef).not.toBe(b.providerRef);
    });
  });

  describe("createIntent — scénario 'failure'", () => {
    it("encode 'fail' dans la ref et capture → failed", async () => {
      const { providerRef } = await provider.createIntent({
        ...baseInput,
        metadata: { scenario: "failure" },
      });
      expect(providerRef).toMatch(/^mock_fail_[0-9a-z]+$/);
      await expect(provider.capture(providerRef)).resolves.toEqual({ status: "failed" });
    });
  });

  describe("createIntent — scénario 'pending'", () => {
    it("encode 'pending' dans la ref et capture → pending", async () => {
      const { providerRef } = await provider.createIntent({
        ...baseInput,
        metadata: { scenario: "pending" },
      });
      expect(providerRef).toMatch(/^mock_pending_[0-9a-z]+$/);
      await expect(provider.capture(providerRef)).resolves.toEqual({ status: "pending" });
    });
  });

  describe("createIntent — scénario 'delayed'", () => {
    it("crée l'intention (le PSP a accepté) et capture → succeeded", async () => {
      const { providerRef } = await provider.createIntent({
        ...baseInput,
        metadata: { scenario: "delayed" },
      });
      expect(providerRef).toMatch(/^mock_delayed_[0-9a-z]+$/);
      await expect(provider.capture(providerRef)).resolves.toEqual({ status: "succeeded" });
    });
  });

  it("jette sur un scénario inconnu", async () => {
    await expect(
      provider.createIntent({ ...baseInput, metadata: { scenario: "explode" } }),
    ).rejects.toThrow(/scenario inconnu/i);
  });

  describe("capture", () => {
    it("jette si la ref est vide", async () => {
      await expect(provider.capture("")).rejects.toThrow(/videro|vide/i);
    });
  });

  describe("refund", () => {
    it("renvoie une refundRef 're_<cuid2>' avec status succeeded", async () => {
      const r = await provider.refund("mock_abc123");
      expect(r.refundRef).toMatch(/^re_[0-9a-z]+$/);
      expect(r.status).toBe("succeeded");
    });

    it("accepte un remboursement partiel (amount fourni)", async () => {
      const r = await provider.refund("mock_abc123", { amountCents: 1000, currency: "EUR" });
      expect(r.status).toBe("succeeded");
    });

    it("jette sur un montant nul ou négatif", async () => {
      await expect(
        provider.refund("mock_abc123", { amountCents: 0, currency: "EUR" }),
      ).rejects.toThrow(/amountCents/i);
    });
  });

  describe("verifyWebhook", () => {
    it("cas valide : renvoie provider/eventKey/type/data", async () => {
      const verified = await provider.verifyWebhook({
        headers: { [MOCK_SIGNATURE_HEADER]: "t=mock,v1=abc" },
        rawBody: JSON.stringify({
          eventKey: "evt_123",
          type: "payment_intent.succeeded",
          data: { providerRef: "mock_x" },
        }),
      });
      expect(verified.provider).toBe("mock");
      expect(verified.eventKey).toBe("evt_123");
      expect(verified.type).toBe("payment_intent.succeeded");
      expect(verified.data).toEqual({ providerRef: "mock_x" });
    });

    it("cas valide : header de signature absent toléré en mode mock", async () => {
      const verified = await provider.verifyWebhook({
        headers: {},
        rawBody: JSON.stringify({ eventKey: "evt_no_header", type: "x", data: null }),
      });
      expect(verified.eventKey).toBe("evt_no_header");
    });

    it("jette si eventKey est absent", async () => {
      await expect(
        provider.verifyWebhook({
          headers: { [MOCK_SIGNATURE_HEADER]: "t=mock,v1=abc" },
          rawBody: JSON.stringify({ type: "payment_intent.succeeded", data: {} }),
        }),
      ).rejects.toThrow(/eventKey/i);
    });

    it("jette si eventKey est vide", async () => {
      await expect(
        provider.verifyWebhook({
          headers: {},
          rawBody: JSON.stringify({ eventKey: "   ", type: "x", data: {} }),
        }),
      ).rejects.toThrow(/eventKey/i);
    });

    it("jette si le body n'est pas du JSON", async () => {
      await expect(
        provider.verifyWebhook({ headers: {}, rawBody: "not-json" }),
      ).rejects.toThrow(/JSON invalide/i);
    });

    it("jette si le header de signature est présent mais vide", async () => {
      await expect(
        provider.verifyWebhook({
          headers: { [MOCK_SIGNATURE_HEADER]: "" },
          rawBody: JSON.stringify({ eventKey: "evt_x", type: "x", data: {} }),
        }),
      ).rejects.toThrow(/signature/i);
    });
  });
});
