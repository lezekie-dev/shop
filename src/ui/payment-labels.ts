import type { PaymentStatus } from "@prisma/client";

/**
 * Libellés de paiement partagés par les pages de commande (suivi invité et
 * espace client).
 *
 * Ces tables vivaient en double dans la page de suivi ; deux copies finissent
 * toujours par diverger, et le client verrait alors « Virement bancaire » dans
 * son espace et « Virement » dans son email de confirmation.
 */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  mock: "Paiement simulé (test)",
  mobile_money: "Mobile Money (Orange / MTN)",
  bank_transfer: "Virement bancaire",
  stripe: "Carte bancaire (Stripe)",
};

export type PaymentStatusMeta = { label: string; className: string; symbol: string };

export const PAYMENT_STATUS_META: Record<PaymentStatus, PaymentStatusMeta> = {
  PENDING: { label: "En attente", className: "badge badge-pending", symbol: "⏳" },
  SUCCEEDED: { label: "Encaissé", className: "badge badge-paid", symbol: "✓" },
  FAILED: { label: "Échoué", className: "badge badge-cancelled", symbol: "✕" },
  REFUNDED: { label: "Remboursé", className: "badge badge-neutral", symbol: "↩" },
};

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "En préparation chez le transporteur",
  IN_TRANSIT: "En cours d'acheminement",
  DELIVERED: "Livré",
  RETURNED: "Retourné à l'expéditeur",
};

/**
 * Page d'instructions de paiement encore attendues, selon la méthode.
 * `null` quand aucune page n'existe pour ce moyen (paiement déjà encaissé ou
 * moyen sans instructions à revoir).
 */
export function pendingPaymentHref(provider: string, paymentRef: string | null): string | null {
  if (!paymentRef) return null;
  if (provider === "bank_transfer") return `/paiement/virement/${paymentRef}`;
  if (provider === "mobile_money") return `/paiement/mobile-money/${paymentRef}`;
  return null;
}
