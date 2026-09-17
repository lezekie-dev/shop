/**
 * Registry — sélectionne l'adaptateur `PaymentProvider` à partir de l'env.
 *
 * Pas de cache : permet de switcher le provider entre tests / boot dynamique
 * sans devoir redémarrer.
 *
 * Providers disponibles :
 *   - "mock"          : simulation complète (success/failure/pending/delayed,
 *                       refund, webhooks) — aucun compte tiers requis.
 *   - "mobile_money"  : Orange Money / MTN, SIMULÉ (parcours USSD + callback),
 *                       prêt à brancher sur un agrégateur réel.
 *   - "bank_transfer" : virement bancaire, aucune API (instructions IBAN +
 *                       validation manuelle par le marchand).
 *   - "stripe"        : NON implémenté — lève une erreur explicite (voir
 *                       `STRIPE_NOT_CONFIGURED`).
 */

import { BankTransferPaymentProvider } from "@/domain/payment/bank-transfer";
import { MobileMoneyPaymentProvider } from "@/domain/payment/mobile-money";
import { MockPaymentProvider } from "@/domain/payment/mock";
import type { PaymentProvider } from "@/domain/payment/provider";

export type PaymentProviderName = "mock" | "stripe" | "mobile_money" | "bank_transfer";

export type AvailableProvider = {
  name: PaymentProviderName;
  label: string;
  available: boolean;
  reason?: string;
};

/** Message unique pour le provider manquant — utilisé par select + list. */
export const STRIPE_NOT_CONFIGURED =
  "StripePaymentProvider non configuré : définir STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET, " +
  "puis implémenter src/domain/payment/stripe.ts (voir ARCHITECTURE.md §3, ticket S3). " +
  "Le mode 'mock' couvre tous les scénarios en attendant.";

export const KNOWN_PROVIDERS: readonly PaymentProviderName[] = [
  "mock",
  "mobile_money",
  "bank_transfer",
  "stripe",
];

const LABELS: Record<PaymentProviderName, string> = {
  mock: "Paiement simulé (test)",
  mobile_money: "Mobile Money (Orange / MTN)",
  bank_transfer: "Virement bancaire",
  stripe: "Carte bancaire (Stripe)",
};

function instantiate(name: PaymentProviderName): PaymentProvider {
  switch (name) {
    case "mock":
      return new MockPaymentProvider();
    case "mobile_money":
      return new MobileMoneyPaymentProvider();
    case "bank_transfer":
      return new BankTransferPaymentProvider();
    case "stripe":
      throw new Error(STRIPE_NOT_CONFIGURED);
  }
}

/**
 * Renvoie l'adaptateur demandé.
 * Sans argument, lit `process.env.PAYMENT_PROVIDER` (défaut "mock").
 */
export function selectPaymentProvider(name?: string): PaymentProvider {
  const which = name ?? process.env.PAYMENT_PROVIDER ?? "mock";
  if ((KNOWN_PROVIDERS as readonly string[]).includes(which)) {
    return instantiate(which as PaymentProviderName);
  }
  throw new Error(
    `selectPaymentProvider: PAYMENT_PROVIDER inconnu : "${which}" (attendu: ${KNOWN_PROVIDERS.join(" | ")})`,
  );
}

/**
 * Liste les providers et leur disponibilité — consommé par l'UI checkout
 * (GET /api/payments/providers) pour n'afficher que ce qui marche vraiment.
 */
export function listAvailableProviders(): AvailableProvider[] {
  // Cohérence garantie : `available: true` ⇔ `selectPaymentProvider(name)`
  // ne jette pas. On le vérifie réellement plutôt que de dupliquer la règle.
  return KNOWN_PROVIDERS.map((name) => {
    try {
      instantiate(name);
      return { name, label: LABELS[name], available: true };
    } catch (err) {
      return {
        name,
        label: LABELS[name],
        available: false,
        reason: err instanceof Error ? err.message : "Provider indisponible",
      };
    }
  });
}
