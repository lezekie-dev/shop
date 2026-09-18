"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@prisma/client";
import type { ComponentType, SVGProps } from "react";

import { can, type Capability } from "@/domain/access";
import {
  IconDashboard,
  IconEmails,
  IconOrders,
  IconProducts,
  IconShield,
  IconStock,
  IconTasks,
  IconUsers,
} from "@/ui/components/icons";

/**
 * Navigation du back-office.
 *
 * Client component uniquement pour `usePathname` : le lien actif doit être
 * marqué visuellement ET annoncé à l'accessibilité (`aria-current="page"`).
 * Un Server Component ne peut pas connaître l'URL courante.
 *
 * FILTRAGE PAR CAPACITÉ : chaque entrée déclare la capacité qui l'ouvre, et la
 * barre ne rend que celles que le rôle porte. La source de la décision est
 * `src/domain/access.ts`, la MÊME que celle utilisée par les gardes serveur —
 * donc un menu ne peut pas diverger de l'autorisation réelle.
 *
 * ATTENTION : masquer un lien n'est PAS une protection. Un utilisateur qui tape
 * `/admin/users` à la main doit être refusé, et c'est le rôle de
 * `requireCapability()` (pages) et de `requireApiCapability()` (API). Le
 * filtrage ici est du confort de lecture, la sécurité est côté serveur.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Capacité exigée pour voir ET ouvrir l'entrée. */
  capability: Capability;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Tableau de bord", Icon: IconDashboard, capability: "dashboard:view" },
  { href: "/admin/orders", label: "Commandes", Icon: IconOrders, capability: "orders:read" },
  // Paiements en attente : ce sont des commandes qu'on ne doit pas expédier,
  // donc du même niveau d'information que la liste des commandes — et le même
  // droit (`orders:read`, ADMIN et STAFF). Les actions de la page, elles, sont
  // filtrées par la matrice de capacités.
  { href: "/admin/paiements", label: "Paiements", Icon: IconEuro, capability: "orders:read" },
  // Catalogue : ADMIN seulement — STAFF n'a pas `products:read` (CONVENTIONS §13).
  { href: "/admin/products", label: "Produits", Icon: IconProducts, capability: "products:read" },
  { href: "/admin/stock", label: "Stock", Icon: IconStock, capability: "products:read" },
  // Boîte d'envoi transactionnelle : ce sont les emails des commandes, donc du
  // même niveau d'information que la liste des commandes.
  { href: "/admin/emails", label: "Emails", Icon: IconEmails, capability: "orders:read" },
  // Gestion des comptes internes : ADMIN uniquement (users:read).
  { href: "/admin/users", label: "Utilisateurs", Icon: IconUsers, capability: "users:read" },
  // Journal des tâches planifiées : les deux rôles. Un job en échec doit être
  // visible par celui qui traite les commandes, pas seulement par l'admin.
  { href: "/admin/taches", label: "Tâches", Icon: IconTasks, capability: "jobs:read" },
  // Sécurité du compte courant : accessible à tout compte interne connecté.
  { href: "/admin/security", label: "Sécurité", Icon: IconShield, capability: "auth:login" },
];

/** Entrées visibles pour un rôle donné. */
export function visibleNavItems(role: Role): readonly AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => can(role, item.capability));
}

/** `/admin` ne doit pas être « actif » quand on est sur `/admin/orders`. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({
  items,
}: {
  /**
   * Entrées autorisées, calculées CÔTÉ SERVEUR à partir du rôle (layout).
   * Prop OBLIGATOIRE : un défaut « toutes les entrées » ferait apparaître les
   * liens réservés à l'administration le jour où quelqu'un oublie la prop.
   */
  items: readonly AdminNavItem[];
}) {
  const pathname = usePathname() ?? "/admin";

  return (
    <nav className="admin-nav" aria-label="Navigation du back-office">
      <ul className="admin-nav__list">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={
                  active ? "admin-nav__link admin-nav__link--active" : "admin-nav__link"
                }
                aria-current={active ? "page" : undefined}
              >
                <item.Icon className="admin-nav__icon" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
