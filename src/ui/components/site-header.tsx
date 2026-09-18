"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { IconSearch } from "@/ui/components/icons";

/**
 * En-tête public de la boutique : marque, recherche, navigation par catégorie
 * et panier.
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
 *
 * Les CATÉGORIES arrivent en propriété depuis le layout racine (composant
 * serveur) : l'en-tête est client pour ses états actifs et son compteur de
 * panier, mais il ne doit pas aller chercher les catégories par une requête
 * `fetch` après chargement — sur 3G, une barre de navigation qui apparaît en
 * deuxième vague est plus coûteuse qu'un tableau de plus dans le HTML.
 */

const SHOP_NAME = process.env.NEXT_PUBLIC_SHOP_NAME ?? "Shop";

/** Sous-ensemble de catégorie dont l'en-tête a besoin (type structurel). */
export interface HeaderCategory {
  slug: string;
  name: string;
}

/**
 * Barre de recherche — un formulaire GET, donc une URL (`/products?q=…`).
 *
 * POURQUOI pas de recherche en JavaScript : elle resterait inutilisable sans
 * JS, ne serait pas partageable, et demanderait de charger un index côté
 * client. Un formulaire fonctionne dès le premier octet de HTML reçu.
 *
 * POURQUOI l'action est toujours `/products` : la recherche part du catalogue
 * ENTIER, même quand on est dans une catégorie. Chercher dans le seul rayon
 * courant ferait dire à un visiteur que le produit n'existe pas alors qu'il
 * est simplement rangé ailleurs.
 */
function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form className="site-header__search" action="/products" method="get" role="search">
      <label className="sr-only" htmlFor="site-search">
        Rechercher un produit
      </label>
      <input
        id="site-search"
        className="site-header__search-input"
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Sac, tote, casquette…"
        autoComplete="off"
        // `enterKeyHint` : sur mobile, le clavier affiche « Rechercher »
        // au lieu du retour à la ligne générique.
        enterKeyHint="search"
      />
      <button type="submit" className="site-header__search-submit">
        <IconSearch className="site-header__search-icon" />
        <span className="sr-only">Rechercher</span>
      </button>
    </form>
  );
}

/**
 * Le champ garde la recherche en cours dans la barre (`?q=…`).
 *
 * Isolé dans son propre composant + `Suspense` : `useSearchParams()` suspend
 * le rendu, et sans limite `<Suspense>` Next refuserait de pré-rendre les
 * pages statiques de l'application.
 */
function SearchFormWithQuery() {
  const params = useSearchParams();
  return <SearchForm defaultValue={params.get("q") ?? ""} />;
}

export function SiteHeader({ categories = [] }: { categories?: HeaderCategory[] }) {
  const pathname = usePathname() ?? "/";
  const [count, setCount] = useState<number | null>(null);
  const isProducts = pathname === "/products" || pathname.startsWith("/products/");
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

        <nav className="site-header__nav site-header__cats" aria-label="Navigation principale">
          <Link
            href="/products"
            aria-current={isProducts ? "page" : undefined}
            className={isProducts ? "site-header__link site-header__link--active" : "site-header__link"}
          >
            Boutique
          </Link>
          {/* Catégories dans l'ordre voulu par le marchand (`position`) : la
              navigation suit l'ordre commercial, jamais l'alphabet. */}
          {categories.map((category) => {
            const href = `/categorie/${category.slug}`;
            const active = pathname === href;
            return (
              <Link
                key={category.slug}
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  active ? "site-header__link site-header__link--active" : "site-header__link"
                }
              >
                {category.name}
              </Link>
            );
          })}
        </nav>

        <Suspense fallback={<SearchForm />}>
          <SearchFormWithQuery />
        </Suspense>

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
