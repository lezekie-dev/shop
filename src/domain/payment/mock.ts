/**
 * Adaptateur Mock — `PaymentProvider` pour S2.
 *
 * Comportement :
 *  - createIntent : renvoie une ref "mock_<cuid2>" avec expiration +30 min
 *  - capture      : renvoie toujours "succeeded" (pas de PSP réel)
 *  - refund       : non implémenté en S2 (jette)
 *  - verifyWebhook : non implémenté (le mock n'utilise pas de webhook)
 */

import { createId } from "@paralleldrive/cuid2";
import type {
  CreateIntentInput,
  CreateIntentResult,
  Money,
  PaymentProvider,
  VerifyWebhookInput,
} from "@/domain/payment/provider";

const THIRTY_MIN_MS = 30 * 60 * 1000;

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createIntent(_input: CreateIntentInput): Promise<CreateIntentResult> {
    return {
      providerRef: `mock_${createId()}`,
      expiresAt: new Date(Date.now() + THIRTY_MIN_MS),
    };
  }

  async capture(_providerRef: string): Promise<{ status: "succeeded" | "pending" | "failed" }> {
    return { status: "succeeded" };
  }

  async refund(_providerRef: string, _amount?: Money): Promise<{ refundRef: string; status: "succeeded" | "pending" }> {
    throw new Error("MockPaymentProvider.refund: not implemented in S2");
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<never> {
    throw new Error("MockPaymentProvider.verifyWebhook: mock provider does not use webhooks");
  }
}
