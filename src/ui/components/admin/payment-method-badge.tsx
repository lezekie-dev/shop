/**
 * Badge de méthode de paiement.
 *
 * Volontairement SANS code couleur : une méthode n'est ni bonne ni mauvaise.
 * L'information passe par le libellé et un symbole distinct par méthode.
 */

type MethodMeta = {
  label: string;
  symbol: string;
};

const PAYMENT_METHOD_META: Record<string, MethodMeta> = {
  stripe: { label: "Carte (Stripe)", symbol: "▭" },
  mobile_money: { label: "Mobile Money", symbol: "▮" },
  bank_transfer: { label: "Virement", symbol: "⇄" },
  mock: { label: "Simulé", symbol: "◌" },
};

export function paymentMethodLabel(provider: string): string {
  return PAYMENT_METHOD_META[provider]?.label ?? provider;
}

export function paymentMethodSymbol(provider: string): string {
  return PAYMENT_METHOD_META[provider]?.symbol ?? "•";
}

export function PaymentMethodBadge({ provider }: { provider: string }) {
  const meta = PAYMENT_METHOD_META[provider];
  const label = meta?.label ?? `Autre (${provider})`;
  return (
    <span className="badge badge-neutral">
      <span aria-hidden>{meta?.symbol ?? "•"}</span>
      {label}
    </span>
  );
}
