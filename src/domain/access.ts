import type { Role } from "@prisma/client";

/**
 * Politique d'accès du back-office — TypeScript pur, aucune dépendance runtime
 * (cf. CONVENTIONS §2 : `src/domain/` ne fait que des entrées/sorties de
 * données, donc les tests n'ont besoin ni de DB, ni de Next, ni de mock).
 *
 * POURQUOI DES CAPACITÉS ET PAS DES RÔLES EN DUR (CONVENTIONS §13)
 * Les routes admin s'autorisent par capacité (`users:read`,
 * `orders:transition:shipped`, …) et jamais par `role === "ADMIN"`. Sinon,
 * ajouter demain un rôle (SUPER_ADMIN, comptable, livreur externe) oblige à
 * rouvrir chaque `if (role === …)` disséminé dans le code. Ici, la matrice
 * vit à UN endroit : ajouter un rôle = ajouter une ligne dans CAPABILITIES.
 *
 * La « source de vérité » documentaire de cette matrice est
 * `docs/team/CONVENTIONS.md` §13 : toute capacité ajoutée ici doit y être
 * ajoutée en même temps (règle de revue de §13).
 */

/**
 * Une capacité = un droit élémentaire, nommé par domaine puis par action.
 * Union de littéraux et non `enum` : cf. CONVENTIONS §7, on préfère les unions
 * de string literals côté code (l'enum Prisma est réservé aux valeurs en base).
 */
export type Capability =
  | "auth:login"
  | "dashboard:view"
  | "products:read"
  | "products:write"
  | "categories:write"
  | "orders:read"
  | "orders:transition:paid"
  | "orders:transition:preparing"
  | "orders:transition:shipped"
  | "orders:transition:delivered"
  | "orders:transition:cancelled"
  | "orders:refund"
  | "customers:read"
  | "customers:write"
  | "users:read"
  | "users:write"
  | "settings:write"
  | "audit-log:read"
  | "jobs:read";

/**
 * Matrice rôle → capacités (CONVENTIONS §13).
 *
 * ADMIN a tout. STAFF intervient sur le flux d'exploitation quotidien
 * (commandes, préparation, expédition, livraison) et en lecture seule sur les
 * clients ; il ne touche ni au catalogue, ni aux utilisateurs, ni aux
 * paramètres, ni à l'argent (encaissement manuel et remboursement sont des
 * décisions business, donc ADMIN).
 *
 * DÉCISIONS PRISES SUR LES SURFACES QUE §13 NE LISTAIT PAS :
 *   - `/admin/stock` et `PATCH /api/admin/variants/[id]/stock` → `products:write`.
 *     Le stock est une propriété du catalogue ; §13 note explicitement que
 *     « STAFF ne gère pas le catalogue ».
 *   - `/admin/emails` (boîte d'envoi transactionnelle) → `orders:read`. Ces
 *     emails sont les confirmations des commandes, et STAFF voit déjà les
 *     coordonnées clients (`customers:read`) : aucune donnée nouvelle.
 *   - `POST /api/admin/orders/[id]/mark-paid` → `orders:transition:paid`
 *     (capacité ajoutée ici + §13). Confirmer un encaissement est un acte
 *     financier, au même titre que `orders:refund` : ADMIN seul.
 *   - `/admin/taches` (lot J, journal des tâches planifiées) → `jobs:read`,
 *     portée par les DEUX rôles. Un job de sauvegarde ou de réconciliation en
 *     échec doit être visible par celui qui traite les commandes au quotidien ;
 *     la page est en lecture seule et n'expose aucun secret (nom de tâche,
 *     statut, durée, message d'erreur). C'est une information d'exploitation,
 *     pas une donnée financière.
 */
export const CAPABILITIES: Record<Role, readonly Capability[]> = {
  ADMIN: [
    "auth:login",
    "dashboard:view",
    "products:read",
    "products:write",
    "categories:write",
    "orders:read",
    "orders:transition:paid",
    "orders:transition:preparing",
    "orders:transition:shipped",
    "orders:transition:delivered",
    "orders:transition:cancelled",
    "orders:refund",
    "customers:read",
    "customers:write",
    "users:read",
    "users:write",
    "settings:write",
    "audit-log:read",
    "jobs:read",
  ],
  STAFF: [
    "auth:login",
    "dashboard:view",
    "orders:read",
    "orders:transition:preparing",
    "orders:transition:shipped",
    "orders:transition:delivered",
    "customers:read",
    "jobs:read",
  ],
};

/** Toutes les capacités existantes — pratique pour les tests et l'UI. */
export function allCapabilities(): readonly Capability[] {
  return CAPABILITIES.ADMIN;
}

/** Liste des capacités d'un rôle. Renvoie un tableau vide pour un rôle inconnu. */
export function capabilitiesFor(role: Role): readonly Capability[] {
  return CAPABILITIES[role] ?? [];
}

/** `true` si le rôle porte la capacité. Une seule porte d'entrée pour ce test. */
export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

/** `true` si le rôle porte TOUTES les capacités listées (ET logique). */
export function canAll(role: Role, capabilities: readonly Capability[]): boolean {
  return capabilities.every((capability) => can(role, capability));
}

/** `true` si le rôle porte AU MOINS UNE des capacités listées (OU logique). */
export function canAny(role: Role, capabilities: readonly Capability[]): boolean {
  return capabilities.some((capability) => can(role, capability));
}

/** Libellé humain d'un rôle, pour l'en-tête du back-office et les badges. */
export function roleLabel(role: Role): string {
  return role === "ADMIN" ? "Administrateur" : "Opérateur";
}
