import { formatMoneyEur } from "@/domain/pricing";

/**
 * Affiche un montant en centimes formaté EUR (locale fr-FR).
 * - Composant server-friendly (pas d'état, pas d'effet).
 * - Style minimal inline pour rester cohérent avec S1 (pas de CSS global).
 */
export function Money({ cents, currency = "EUR" }: { cents: number; currency?: string }) {
  const text = currency === "EUR" ? formatMoneyEur(cents) : `${cents} ${currency}`;
  return <span>{text}</span>;
}
