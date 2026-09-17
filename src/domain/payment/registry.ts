/**
 * Registry — sélectionne l'adaptateur `PaymentProvider` à partir de l'env.
 *
 * Pas de cache : permet de switcher le provider entre tests / boot dynamique
 * sans devoir redémarrer.
 *
 * En S2, seul "mock" est implémenté. "stripe" / "mobile_money" jetteront
 * — c'est attendu : S3 livrera leurs adaptateurs réels.
 */

import { MockPaymentProvider } from "@/domain/payment/mock";
import type { PaymentProvider } from "@/domain/payment/provider";

export function selectPaymentProvider(): PaymentProvider {
  const which = process.env.PAYMENT_PROVIDER ?? "mock";
  switch (which) {
    case "mock":
      return new MockPaymentProvider();
    case "stripe":
      throw new Error(
        "selectPaymentProvider: StripePaymentProvider n'est pas implémenté (S3).",
      );
    case "mobile_money":
      throw new Error(
        "selectPaymentProvider: MobileMoneyPaymentProvider n'est pas implémenté (S3).",
      );
    default:
      throw new Error(`selectPaymentProvider: PAYMENT_PROVIDER inconnu : "${which}"`);
  }
}
