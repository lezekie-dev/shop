"use client";

import { usePathname } from "next/navigation";

/**
 * En-tête public de la boutique.
 *
 * Masqué sur /admin/* : le back-office a sa propre barre (nom de la boutique,
 * admin connecté, déconnexion), et deux en-têtes empilés n'ont aucun sens.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/admin")) return null;

  return (
    <header className="site-header">
      <a href="/" className="site-header__brand">
        Shop
      </a>
      <nav className="site-header__nav">
        <a href="/products">Catalogue</a>
        <a href="/admin/login" className="site-header__admin">
          Admin
        </a>
      </nav>
    </header>
  );
}
