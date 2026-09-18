"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * En-tête public de la boutique.
 *
 * Masqué sur /admin/* : le back-office a sa propre barre, deux en-têtes
 * empilés n'ont aucun sens.
 *
 * Le lien « Admin » n'apparaît PAS dans la navigation client : sur une
 * boutique, un lien admin visible fait « site de démonstration » et casse la
 * crédibilité. L'entrée au back-office reste accessible par l'URL directe
 * /admin (que seule l'équipe connaît).
 *
 * Le compteur de panier est chargé côté client après montage (pas dans le HTML
 * initial) : il dépend d'un cookie que la page ne lit pas, et l'afficher à 0
 * puis le corriger provoquerait un saut visuel.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [count, setCount] = useState<number | null>(null);
  const isProducts =
    pathname === "/products" || pathname.startsWith("/products/");

  // Recharge le compteur à chaque changement de page : ajouter un article puis
  // naviguer doit rafraîchir le badge, sans rechargement complet.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cart/count")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d: { count?: number }) => {
        if (!cancelled) setCount(typeof d.count === "number" ? d.count : 0);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (pathname.startsWith("/admin")) return null;

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__brand">
          Shop
        </Link>

        <nav className="site-header__nav" aria-label="Navigation principale">
          <Link
            href="/products"
            aria-current={isProducts ? "page" : undefined}
            className={isProducts ? "site-header__link site-header__link--active" : "site-header__link"}
          >
            Catalogue
          </Link>
        </nav>

        <Link href="/cart" className="site-header__cart" aria-label={count === null
            ? "Voir mon panier"
            : `Voir mon panier, ${count} article${count > 1 ? "s" : ""}`}>
          <span aria-hidden>🛒</span>
          <span className="site-header__cart-label">Panier</span>
          {count !== null && count > 0 && (
            <span className="site-header__cart-count num" aria-hidden>
              {count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
