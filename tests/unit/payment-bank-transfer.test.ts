import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BANK_TRANSFER_DEFAULTS,
  BANK_TRANSFER_INSTRUCTIONS_PATH,
  BankTransferPaymentProvider,
  bankTransferDetails,
} from "@/domain/payment/bank-transfer";

const baseInput = {
  orderId: "order_bt_1",
  amount: { amountCents: 6060, currency: "EUR" },
  customer: { email: "client@shop.local", name: "Client Démo" },
  metadata: {},
  returnUrl: "https://shop.local/checkout/success",
};

const ENV_KEYS = ["BANK_TRANSFER_IBAN", "BANK_TRANSFER_HOLDER", "BANK_TRANSFER_BANK_NAME"] as const;

describe("BankTransferPaymentProvider", () => {
  const saved: Record<string, string | undefined> = {};
  let provider: BankTransferPaymentProvider;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    provider = new BankTransferPaymentProvider();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('a name = "bank_transfer"', () => {
    expect(provider.name).toBe("bank_transfer");
  });

  describe("createIntent", () => {
    it("renvoie une ref 'bt_<cuid2>' et un redirectUrl vers les instructions", async () => {
      const result = await provider.createIntent(baseInput);
      expect(result.providerRef).toMatch(/^bt_[0-9a-z]+$/);
      expect(result.redirectUrl).toBe(
        `${BANK_TRANSFER_INSTRUCTIONS_PATH}/${result.providerRef}`,
      );
    });

    it("expire à ~+7 jours", async () => {
      const before = Date.now();
      const result = await provider.createIntent(baseInput);
      const after = Date.now();
      const exp = result.expiresAt!.getTime();
      expect(exp).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
      expect(exp).toBeLessThanOrEqual(after + 7 * 24 * 60 * 60 * 1000 + 1000);
    });
  });

  describe("capture", () => {
    it('renvoie toujours "pending" (validation manuelle par le marchand)', async () => {
      const { providerRef } = await provider.createIntent(baseInput);
      await expect(provider.capture(providerRef)).resolves.toEqual({ status: "pending" });
    });

    it("jette si la ref est vide", async () => {
      await expect(provider.capture("")).rejects.toThrow(/videro|vide/i);
    });
  });

  describe("refund", () => {
    it('renvoie "pending" : le virement retour est fait à la main', async () => {
      const r = await provider.refund("bt_abc123", { amountCents: 1000, currency: "EUR" });
      expect(r.refundRef).toMatch(/^btre_[0-9a-z]+$/);
      expect(r.status).toBe("pending");
    });
  });

  describe("verifyWebhook", () => {
    it("jette : le virement n'a pas de webhook", async () => {
      await expect(
        provider.verifyWebhook({ headers: {}, rawBody: "{}" }),
      ).rejects.toThrow(/webhook/i);
    });
  });

  describe("configuration sans aucune variable d'env", () => {
    it("expose les valeurs de DÉMONSTRATION par défaut", () => {
      const details = bankTransferDetails();
      expect(details.iban).toBe(BANK_TRANSFER_DEFAULTS.iban);
      expect(details.holder).toBe(BANK_TRANSFER_DEFAULTS.holder);
      expect(details.bankName).toBe(BANK_TRANSFER_DEFAULTS.bankName);
    });

    it("createIntent fonctionne sans env configurée", async () => {
      const result = await provider.createIntent(baseInput);
      expect(result.providerRef).toMatch(/^bt_/);
      expect(provider.getDetails().iban).toBe(BANK_TRANSFER_DEFAULTS.iban);
    });

    it("respecte les variables d'env quand elles sont définies", () => {
      process.env.BANK_TRANSFER_IBAN = "FR00 0000 0000 0000 0000 0000 999";
      process.env.BANK_TRANSFER_HOLDER = "Ma Boutique";
      process.env.BANK_TRANSFER_BANK_NAME = "Ma Banque";
      const p = new BankTransferPaymentProvider();
      expect(p.getDetails()).toEqual({
        iban: "FR00 0000 0000 0000 0000 0000 999",
        holder: "Ma Boutique",
        bankName: "Ma Banque",
      });
    });
  });
});
