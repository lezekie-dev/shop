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

const SHOP_NAME = process.env.NEXT_PUBLIC_SHOP_NAME ?? "Shop";

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [count, setCount] = useState<number | null>(null);
  const isProducts =
    pathname === "/products" || pathname.startsWith("/products/");
  const isCart = pathname === "/cart" || pathname.startsWith("/cart/");

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
        {/* Marque : le nom en serif, précédé d'un carré terracotta. Le carré
            est un repère visuel immuable — au scroll, l'œil retrouve le site
            par sa forme avant de lire le mot. */}
        <Link href="/" className="site-header__brand" aria-label={`${SHOP_NAME} — accueil`}>
          <span className="site-header__mark" aria-hidden />
          <span className="site-header__wordmark">{SHOP_NAME}</span>
        </Link>

        <nav className="site-header__nav" aria-label="Navigation principale">
          <Link
            href="/products"
            aria-current={isProducts ? "page" : undefined}
            className={isProducts ? "site-header__link site-header__link--active" : "site-header__link"}
          >
            Boutique
          </Link>
        </nav>

        <Link
          href="/cart"
          className={[
            "site-header__cart",
            isCart ? "site-header__cart--active" : "",
            count !== null && count > 0 ? "site-header__cart--filled" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={isCart ? "page" : undefined}
          aria-label={
            count === null
              ? "Voir mon panier"
              : `Voir mon panier, ${count} article${count > 1 ? "s" : ""}`
          }
        >
          <svg
            className="site-header__cart-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 7h12l-1.2 11.1a2 2 0 0 1-2 1.9H9.2a2 2 0 0 1-2-1.9L6 7Z" />
            <path d="M9.2 7V6a2.8 2.8 0 0 1 5.6 0v1" />
          </svg>
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
