/**
 * Logique pure des commandes (domaine) — aucune dépendance Next/Prisma
 * au-delà des types énumérés générés par Prisma.
 *
 * Deux responsabilités :
 *  - canTransitionTo   : machine à états des OrderStatus
 *  - generateOrderNumber : format "ORD-YYYY-NNNNNN" (seq zero-pad 6)
 */

import { OrderStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────
// Transitions autorisées entre OrderStatus
// ─────────────────────────────────────────────────────────────────────

/**
 * Map des transitions autorisées.
 * - ANNULER (CANCELLED) est possible tant qu'on n'a pas commencé à préparer.
 * - REMBOURSER (REFUNDED) est possible dès que PAID (avant ou après livraison).
 * - DELIVERED et REFUNDED et CANCELLED sont des états terminaux.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, ReadonlyArray<OrderStatus>> = {
  PENDING_PAYMENT: [OrderStatus.PAID, OrderStatus.CANCELLED],
  PAID: [OrderStatus.PREPARING, OrderStatus.REFUNDED, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.SHIPPED],
  SHIPPED: [OrderStatus.DELIVERED],
  DELIVERED: [OrderStatus.REFUNDED],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Indique si une transition `from → to` est autorisée.
 * - Une transition vers soi-même est toujours refusée.
 * - Les états terminaux (CANCELLED, REFUNDED) ne permettent rien.
 */
export function canTransitionTo(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ─────────────────────────────────────────────────────────────────────
// Génération du numéro de commande
// ─────────────────────────────────────────────────────────────────────

/**
 * Génère un numéro de commande lisible "ORD-{YYYY}-{seq zero-pad 6}".
 *
 * @param seq   numéro de séquence (entier strictement positif)
 * @param year  année (par défaut : année courante)
 *
 * Exemples :
 *   generateOrderNumber(1, 2026)        === "ORD-2026-000001"
 *   generateOrderNumber(12345)          === "ORD-{YYYY}-012345"
 */
export function generateOrderNumber(seq: number, year: number = new Date().getFullYear()): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new RangeError(`generateOrderNumber: seq must be a positive integer, got ${seq}`);
  }
  const effectiveYear = year ?? new Date().getFullYear();
  const padded = seq.toString().padStart(6, "0");
  return `ORD-${effectiveYear}-${padded}`;
}
