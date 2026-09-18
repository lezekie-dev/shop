"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";

import {
  IconDashboard,
  IconEmails,
  IconEuro,
  IconOrders,
  IconProducts,
  IconShield,
  IconStock,
  IconTasks,
  IconUsers,
} from "@/ui/components/icons";
import {
  isNavItemActive,
  type AdminNavIconKey,
  type AdminNavItem,
} from "@/ui/components/admin/admin-nav-items";

/**
 * Barre de navigation du back-office.
 *
 * Client component uniquement pour `usePathname` : le lien actif doit être
 * marqué visuellement ET annoncé à l'accessibilité (`aria-current="page"`).
 * Un Server Component ne connaît pas l'URL courante.
 *
 * ── Deux pièges rencontrés ici, tous les deux corrigés ───────────────
 * 1. Les entrées et le filtrage par capacité vivaient dans CE fichier, marqué
 *    `"use client"`. Le layout `/admin` (Server Component) appelait donc
 *    `visibleNavItems()`, qu'il recevait comme une simple référence :
 *    `TypeError: d is not a function` → 500 sur tout le back-office.
 *    Les entrées sont maintenant dans `admin-nav-items.ts`, un module SANS
 *    directive, utilisable des deux côtés.
 * 2. Premier correctif tenté : transmettre les entrées telles quelles, icône
 *    comprise. Or un composant React EST une fonction, et le serveur ne peut
 *    pas envoyer de fonction à un client — `Functions cannot be passed
 *    directly to Client Components`. Le serveur ne transmet donc qu'une CLÉ
 *    (`iconKey`), et la résolution vers le composant se fait ICI, côté client.
 */

/** Résolution des clés d'icône. Doit couvrir toutes les valeurs de la table. */
const ICONS: Record<AdminNavIconKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  dashboard: IconDashboard,
  orders: IconOrders,
  payments: IconEuro,
  products: IconProducts,
  stock: IconStock,
  emails: IconEmails,
  users: IconUsers,
  tasks: IconTasks,
  shield: IconShield,
};

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
          const active = isNavItemActive(pathname, item.href);
          const Icon = ICONS[item.iconKey];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={
                  active ? "admin-nav__link admin-nav__link--active" : "admin-nav__link"
                }
                aria-current={active ? "page" : undefined}
              >
                <Icon className="admin-nav__icon" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
