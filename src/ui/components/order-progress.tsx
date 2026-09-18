import type { OrderStatus } from "@prisma/client";

import { formatDateTime } from "@/ui/format";

/**
 * Frise de progression d'une commande (Commandé → Payé → Expédié → Livré).
 *
 * Extraite de la page de suivi invité pour être partagée avec l'espace client :
 * le client connecté et le client invité regardent la MÊME commande, avec les
 * mêmes jalons. Deux copies auraient divergé au premier changement de libellé.
 *
 * Composant purement présentationnel : il reçoit des dates et un statut, il ne
 * lit ni la base ni la session.
 */
const STEPS = [
  { key: "placed", label: "Commandé" },
  { key: "paid", label: "Payé" },
  { key: "shipped", label: "Expédié" },
  { key: "delivered", label: "Livré" },
] as const;

export function OrderProgress({
  placedAt,
  paidAt,
  shippedAt,
  deliveredAt,
  status,
}: {
  placedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  status: OrderStatus;
}) {
  const stepDates: Array<Date | null> = [placedAt, paidAt, shippedAt, deliveredAt];
  const completed = stepDates.map((d) => d !== null);
  const stopped = status === "CANCELLED" || status === "REFUNDED";
  // `-1` : plus aucune étape n'est « en cours », le parcours s'est arrêté.
  const currentIndex = stopped ? -1 : completed.reduce((acc, done, i) => (done ? i : acc), 0);

  return (
    <ol className="steps">
      {STEPS.map((step, i) => {
        const done = completed[i] === true && i !== currentIndex;
        const current = i === currentIndex;
        const className = [
          "steps__item",
          done ? "steps__item--done" : "",
          current ? "steps__item--current" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const date = stepDates[i] ?? null;
        const isLastStep = i === STEPS.length - 1;
        return (
          <li key={step.key} className={className}>
            <span className="steps__dot" aria-hidden>
              {done ? "✓" : i + 1}
            </span>
            <div className="actions">
              <span className="steps__label">{step.label}</span>
              {current && (
                <span className={isLastStep ? "badge badge-paid" : "badge badge-pending"}>
                  {isLastStep ? "Terminée" : "En cours"}
                </span>
              )}
            </div>
            {date && <span className="steps__date">{formatDateTime(date)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
