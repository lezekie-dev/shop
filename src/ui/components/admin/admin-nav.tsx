"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation du back-office.
 *
 * Client component uniquement pour `usePathname` : le lien actif doit être
 * marqué visuellement ET annoncé à l'accessibilité (`aria-current="page"`).
 * Un Server Component ne peut pas connaître l'URL courante.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: string;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Tableau de bord", icon: "◈" },
  { href: "/admin/orders", label: "Commandes", icon: "❐" },
  { href: "/admin/products", label: "Produits", icon: "◍" },
  { href: "/admin/stock", label: "Stock", icon: "◧" },
  { href: "/admin/emails", label: "Emails", icon: "✉" },
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
                <span className="admin-nav__icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
