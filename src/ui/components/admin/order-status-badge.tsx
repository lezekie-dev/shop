import { OrderStatus } from "@prisma/client";

import { ORDER_STATUSES, isOrderStatus } from "@/domain/order";

/**
 * Badge de statut de commande.
 *
 * Chaque statut porte TROIS signaux indépendants : une classe de couleur
 * (tint de tokens.css), un symbole propre, et un libellé français complet.
 * Retirer la couleur ne fait perdre aucune information.
 *
 * Les formes diffèrent aussi par le `::before` de tokens.css : pastille pleine
 * pour paid/pending, anneau pour shipped, carré pivoté pour cancelled.
 */

type StatusMeta = {
  label: string;
  className: string;
  symbol: string;
};

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  PENDING_PAYMENT: { label: "En attente de paiement", className: "badge badge-pending", symbol: "⏳" },
  PAID: { label: "Payée", className: "badge badge-paid", symbol: "✓" },
  PREPARING: { label: "En préparation", className: "badge badge-pending", symbol: "◆" },
  SHIPPED: { label: "Expédiée", className: "badge badge-shipped", symbol: "➤" },
  DELIVERED: { label: "Livrée", className: "badge badge-paid", symbol: "⌂" },
  CANCELLED: { label: "Annulée", className: "badge badge-cancelled", symbol: "✕" },
  REFUNDED: { label: "Remboursée", className: "badge badge-neutral", symbol: "↩" },
};

/** Ordre d'affichage des filtres : le cycle de vie d'une commande. */
export const ORDER_STATUS_ORDER: readonly OrderStatus[] = ORDER_STATUSES;

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_META[status].label;
}

/** Libellé d'un statut reçu en query param, sans planter sur une valeur inconnue. */
export function orderStatusLabelOrSelf(value: string): string {
  return isOrderStatus(value) ? ORDER_STATUS_META[value].label : value;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <span className={meta.className}>
      <span aria-hidden>{meta.symbol}</span>
      {meta.label}
    </span>
  );
}
