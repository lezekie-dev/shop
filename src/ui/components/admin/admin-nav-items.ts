import type { Role } from "@prisma/client";

import { can, type Capability } from "@/domain/access";

/**
 * DONNÉES de la navigation du back-office — séparées du composant qui l'affiche.
 *
 * ── Pourquoi ce fichier existe ───────────────────────────────────────
 * Ces éléments vivaient dans `admin-nav.tsx`, qui porte `"use client"`. Le
 * layout `/admin` est un Server Component : en important `visibleNavItems()`
 * depuis un module client, il recevait une simple RÉFÉRENCE au lieu de la
 * fonction, et le rendu levait `TypeError: d is not a function`.
 *
 * ── Pourquoi les icônes sont désignées par une CLÉ et non par le composant ──
 * Première tentative de correction : déplacer les mêmes objets ici. Ça a
 * produit une erreur 500 sur TOUT le back-office — `Functions cannot be passed
 * directly to Client Components`. Un composant React EST une fonction : le
 * serveur ne peut pas l'envoyer au client dans les props.
 *
 * D'où cette forme : le serveur transmet `iconKey` (une chaîne sérialisable),
 * et c'est le composant client qui résout la clé vers son composant d'icône.
 * Chaque côté reste maître de ses fonctions, et le filtrage par capacité reste
 * côté serveur.
 *
 * FILTRAGE PAR CAPACITÉ : chaque entrée déclare la capacité qui l'ouvre, et la
 * décision vient de `src/domain/access.ts` — la MÊME source que les gardes
 * serveur. Un menu ne peut donc pas diverger de l'autorisation réelle.
 *
 * ATTENTION : masquer un lien n'est PAS une protection. Un utilisateur qui tape
 * `/admin/users` à la main doit être refusé, et c'est le rôle de
 * `requireCapability()` (pages) et de `requireApiCapability()` (API). Le
 * filtrage ici est du confort de lecture ; la sécurité est côté serveur.
 */

/** Nom d'icône reconnu par le composant client (voir `admin-nav.tsx`). */
export type AdminNavIconKey =
  | "dashboard"
  | "orders"
  | "payments"
  | "products"
  | "stock"
  | "emails"
  | "users"
  | "tasks"
  | "shield";

/** Entrée de navigation, entièrement sérialisable (aucune fonction). */
export type AdminNavItem = {
  href: string;
  label: string;
  iconKey: AdminNavIconKey;
  /** Capacité exigée pour voir ET ouvrir l'entrée. */
  capability: Capability;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Tableau de bord", iconKey: "dashboard", capability: "dashboard:view" },
  { href: "/admin/orders", label: "Commandes", iconKey: "orders", capability: "orders:read" },
  // Paiements en attente : ce sont des commandes qu'on ne doit pas expédier,
  // donc du même niveau d'information que la liste des commandes — et le même
  // droit (`orders:read`, ADMIN et STAFF). Les actions de la page, elles, sont
  // filtrées par la matrice de capacités.
  { href: "/admin/paiements", label: "Paiements", iconKey: "payments", capability: "orders:read" },
  // Catalogue : ADMIN seulement — STAFF n'a pas `products:read` (CONVENTIONS §13).
  { href: "/admin/products", label: "Produits", iconKey: "products", capability: "products:read" },
  { href: "/admin/stock", label: "Stock", iconKey: "stock", capability: "products:read" },
  // Boîte d'envoi transactionnelle : ce sont les emails des commandes, donc du
  // même niveau d'information que la liste des commandes.
  { href: "/admin/emails", label: "Emails", iconKey: "emails", capability: "orders:read" },
  // Gestion des comptes internes : ADMIN uniquement (users:read).
  { href: "/admin/users", label: "Utilisateurs", iconKey: "users", capability: "users:read" },
  // Journal des tâches planifiées : les deux rôles. Un job en échec doit être
  // visible par celui qui traite les commandes, pas seulement par l'admin.
  { href: "/admin/taches", label: "Tâches", iconKey: "tasks", capability: "jobs:read" },
  // Sécurité du compte courant : accessible à tout compte interne connecté.
  { href: "/admin/security", label: "Sécurité", iconKey: "shield", capability: "auth:login" },
];

/** Entrées visibles pour un rôle donné. */
export function visibleNavItems(role: Role): readonly AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => can(role, item.capability));
}

/** `/admin` ne doit pas être « actif » quand on est sur `/admin/orders`. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
