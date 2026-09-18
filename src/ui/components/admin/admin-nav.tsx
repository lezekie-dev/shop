"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";

import {
  IconDashboard,
  IconEmails,
  IconOrders,
  IconProducts,
  IconStock,
} from "@/ui/components/icons";

/**
 * Navigation du back-office.
 *
 * Client component uniquement pour `usePathname` : le lien actif doit être
 * marqué visuellement ET annoncé à l'accessibilité (`aria-current="page"`).
 * Un Server Component ne peut pas connaître l'URL courante.
 *
 * Les icônes sont des composants SVG et non des glyphes Unicode : un
 * caractère comme « ◈ » est dessiné par la police du système, avec une taille
 * optique et un alignement vertical qui changent d'un appareil à l'autre.
 * Dans une barre de navigation lue en permanence, ce flottement se voit.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Tableau de bord", Icon: IconDashboard },
  { href: "/admin/orders", label: "Commandes", Icon: IconOrders },
  { href: "/admin/products", label: "Produits", Icon: IconProducts },
  { href: "/admin/stock", label: "Stock", Icon: IconStock },
  { href: "/admin/emails", label: "Emails", Icon: IconEmails },
];

/** `/admin` ne doit pas être « actif » quand on est sur `/admin/orders`. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname() ?? "/admin";

  return (
    <nav className="admin-nav" aria-label="Navigation du back-office">
      <ul className="admin-nav__list">
        {ADMIN_NAV_ITEMS.map((item) => {
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
