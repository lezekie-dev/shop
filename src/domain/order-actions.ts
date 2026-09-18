/**
 * Prédicats d'action sur une commande — module CLIENT-SAFE.
 *
 * `import type` uniquement : aucune valeur de `@prisma/client` n'entre dans le
 * bundle navigateur, contrairement à `@/domain/order`. Les composants client
 * (boutons « marquer payée / expédiée ») peuvent donc les utiliser directement
 * et n'afficher que les actions que l'API acceptera réellement.
 *
 * Ces deux fonctions sont le miroir exact des gardes des routes :
 *   - POST /api/admin/orders/[id]/mark-paid    (bank_transfer + PENDING_PAYMENT)
 *   - POST /api/admin/orders/[id]/mark-shipped (PAID ou PREPARING)
 */

import type { OrderStatus } from "@prisma/client";

export function canMarkPaid(order: {
  status: OrderStatus;
  paymentProvider: string;
}): boolean {
  return order.status === "PENDING_PAYMENT" && order.paymentProvider === "bank_transfer";
}

export function canMarkShipped(order: { status: OrderStatus }): boolean {
  return order.status === "PAID" || order.status === "PREPARING";
}
