import { OrderStatus } from "@prisma/client";

/**
 * Badge de statut de commande côté client.
 *
 * Chaque statut porte TROIS signaux indépendants : une classe de couleur
 * (tint de tokens.css), un symbole propre, et un libellé français complet.
 * Retirer la couleur ne fait perdre aucune information.
 *
 * Les classes sont celles de tokens.css — les mêmes que le back-office
 * (`admin/order-status-badge.tsx`), pour que le site et son administration
 * racontent la même chose de la même façon. La forme du `::before` change
 * aussi selon la classe : pastille pleine (paid/pending), anneau (shipped),
 * carré pivoté (cancelled).
 */

type StatusMeta = {
  label: string;
  className: string;
  symbol: string;
};

const STATUS_META: Record<OrderStatus, StatusMeta> = {
  PENDING_PAYMENT: {
    label: "En attente de paiement",
    className: "badge badge-pending",
    symbol: "⏳",
  },
  PAID: { label: "Payée", className: "badge badge-paid", symbol: "✓" },
  PREPARING: { label: "En préparation", className: "badge badge-pending", symbol: "◆" },
  SHIPPED: { label: "Expédiée", className: "badge badge-shipped", symbol: "➤" },
  DELIVERED: { label: "Livrée", className: "badge badge-paid", symbol: "⌂" },
  CANCELLED: { label: "Annulée", className: "badge badge-cancelled", symbol: "✕" },
  REFUNDED: { label: "Remboursée", className: "badge badge-neutral", symbol: "↩" },
};

/**
 * `aria-label` en clair : un lecteur d'écran annonce « Statut : Payée » et non
 * « coche Payée ». Le symbole est décoratif.
 */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={meta.className} aria-label={`Statut : ${meta.label}`}>
      <span aria-hidden>{meta.symbol}</span>
      {meta.label}
    </span>
  );
}
