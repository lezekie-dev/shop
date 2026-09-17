import { beforeEach, describe, expect, it } from "vitest";

import {
  MOBILE_MONEY_INSTRUCTIONS_PATH,
  MOBILE_MONEY_OPERATORS,
  MOBILE_MONEY_SIGNATURE_HEADER,
  MobileMoneyPaymentProvider,
  normalizeOperator,
} from "@/domain/payment/mobile-money";

const baseInput = {
  orderId: "order_mm_1",
  amount: { amountCents: 12000, currency: "XAF" },
  customer: { email: "client@shop.local", name: "Client Démo" },
  returnUrl: "https://shop.local/checkout/success",
};

describe("MobileMoneyPaymentProvider", () => {
  let provider: MobileMoneyPaymentProvider;

  beforeEach(() => {
    provider = new MobileMoneyPaymentProvider();
  });

  it('a name = "mobile_money"', () => {
    expect(provider.name).toBe("mobile_money");
  });

  it("expose les 2 opérateurs supportés (Orange, MTN)", () => {
    expect(MOBILE_MONEY_OPERATORS.map((o) => o.code)).toEqual(["ORANGE", "MTN"]);
  });

  describe("createIntent — Orange Money", () => {
    it("renvoie une ref 'mm_ORANGE_<cuid2>', un redirectUrl USSD et ~+15 min", async () => {
      const before = Date.now();
      const result = await provider.createIntent({
        ...baseInput,
        metadata: { operator: "ORANGE", phone: "+237600000001" },
      });
      const after = Date.now();

      expect(result.providerRef).toMatch(/^mm_ORANGE_[0-9a-z]+$/);
      expect(result.redirectUrl).toBe(
        `${MOBILE_MONEY_INSTRUCTIONS_PATH}/${result.providerRef}`,
      );
      const exp = result.expiresAt!.getTime();
      expect(exp).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
      expect(exp).toBeLessThanOrEqual(after + 15 * 60 * 1000 + 1000);
    });

    it("accepte l'opérateur en minuscules (normalisation)", async () => {
      const result = await provider.createIntent({
        ...baseInput,
        metadata: { operator: "orange", phone: "+237600000001" },
      });
      expect(result.providerRef).toMatch(/^mm_ORANGE_/);
    });
  });

  describe("createIntent — MTN Mobile Money", () => {
    it("renvoie une ref 'mm_MTN_<cuid2>'", async () => {
      const result = await provider.createIntent({
        ...baseInput,
        metadata: { operator: "MTN", phone: "+237600000002" },
      });
      expect(result.providerRef).toMatch(/^mm_MTN_[0-9a-z]+$/);
      expect(result.redirectUrl).toContain(MOBILE_MONEY_INSTRUCTIONS_PATH);
    });
  });

  describe("createIntent — entrées invalides", () => {
    it("jette si l'opérateur est absent", async () => {
      await expect(
        provider.createIntent({ ...baseInput, metadata: { phone: "+237600000001" } }),
      ).rejects.toThrow(/operator/i);
    });

    it("jette si l'opérateur est inconnu", async () => {
      await expect(
        provider.createIntent({
          ...baseInput,
          metadata: { operator: "WAVE", phone: "+237600000001" },
        }),
      ).rejects.toThrow(/opérateur inconnu/i);
    });

    it("jette si le numéro est absent", async () => {
      await expect(
        provider.createIntent({ ...baseInput, metadata: { operator: "MTN" } }),
      ).rejects.toThrow(/phone/i);
    });
  });

  describe("capture — les 3 issues", () => {
    it('ref normale → "succeeded"', async () => {
      const { providerRef } = await provider.createIntent({
        ...baseInput,
        metadata: { operator: "ORANGE", phone: "+237600000001" },
      });
      await expect(provider.capture(providerRef)).resolves.toEqual({ status: "succeeded" });
    });

    it('ref contenant "pending" → "pending" (USSD pas encore validé par le client)', async () => {
      await expect(provider.capture("mm_ORANGE_pending_abc123")).resolves.toEqual({
        status: "pending",
      });
    });

    it('ref contenant "fail" → "failed" (solde insuffisant / numéro non enregistré)', async () => {
      await expect(provider.capture("mm_MTN_fail_abc123")).resolves.toEqual({ status: "failed" });
    });

    it("jette si la ref est vide", async () => {
      await expect(provider.capture("")).rejects.toThrow(/videro|vide/i);
    });
  });

  describe("refund", () => {
    it("renvoie une refundRef 'mmre_<cuid2>' avec status succeeded", async () => {
      const r = await provider.refund("mm_ORANGE_abc123", {
        amountCents: 12000,
        currency: "XAF",
      });
      expect(r.refundRef).toMatch(/^mmre_[0-9a-z]+$/);
      expect(r.status).toBe("succeeded");
    });

    it("jette sur un montant nul", async () => {
      await expect(
        provider.refund("mm_ORANGE_abc123", { amountCents: 0, currency: "XAF" }),
      ).rejects.toThrow(/amountCents/i);
    });
  });

  describe("verifyWebhook", () => {
    it("valide un callback simulé (header de signature + eventKey)", async () => {
      const verified = await provider.verifyWebhook({
        headers: { [MOBILE_MONEY_SIGNATURE_HEADER]: "t=mock,v1=signature" },
        rawBody: JSON.stringify({
          eventKey: "mm_evt_001",
          type: "payment.succeeded",
          data: { providerRef: "mm_ORANGE_x", status: "succeeded" },
        }),
      });
      expect(verified.provider).toBe("mobile_money");
      expect(verified.eventKey).toBe("mm_evt_001");
      expect(verified.type).toBe("payment.succeeded");
    });

    it("jette si eventKey est absent", async () => {
      await expect(
        provider.verifyWebhook({
          headers: { [MOBILE_MONEY_SIGNATURE_HEADER]: "t=mock,v1=signature" },
          rawBody: JSON.stringify({ type: "payment.succeeded", data: {} }),
        }),
      ).rejects.toThrow(/eventKey/i);
    });

    it("jette sur un body non JSON", async () => {
      await expect(
        provider.verifyWebhook({ headers: {}, rawBody: "<xml/>" }),
      ).rejects.toThrow(/JSON invalide/i);
    });
  });

  describe("normalizeOperator", () => {
    it("normalise et rejette", () => {
      expect(normalizeOperator(" orange ")).toBe("ORANGE");
      expect(normalizeOperator("mtn")).toBe("MTN");
      expect(() => normalizeOperator("moov")).toThrow(/opérateur inconnu/i);
    });
  });
});
