/**
 * Formate un montant en centimes vers une chaîne "12,34 €".
 * - Pas de Float pour la valeur : on divise par 100 sur entiers (gère les nombres négatifs).
 * - Locale : fr-FR pour le séparateur des milliers + virgule décimale.
 */
export function formatMoneyEur(cents: number): string {
  if (!Number.isFinite(cents)) {
    throw new TypeError(`formatMoneyEur: amount must be a finite number, got ${cents}`);
  }
  const centsRounded = Math.round(cents);
  const negative = centsRounded < 0;
  const abs = Math.abs(centsRounded);
  const euros = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const eurosFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(euros);
  const centsStr = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${eurosFmt},${centsStr} €`;
}

/** Total en centimes d'une liste de lignes (quantité × prix unitaire). */
export function linesTotalCents(lines: Array<{ quantity: number; unitPriceCents: number }>): number {
  return lines.reduce((acc, l) => acc + l.quantity * l.unitPriceCents, 0);
}
