import Link from "next/link";

import { buildCatalogHref, type CatalogSort } from "@/domain/catalog";

/**
 * Pastilles de navigation par catégorie, avec le nombre de produits publiés.
 *
 * Composant PARTAGÉ entre `/products` et `/categorie/[slug]` : c'est le même
 * geste (« je change de rayon ») depuis l'une ou l'autre page, il doit donc
 * être identique et garder la recherche en cours.
 *
 * POURQUOI des liens et pas des boutons : chaque catégorie a son URL propre
 * (`/categorie/<slug>`), ce qui est meilleur pour le référencement et permet
 * de partager un rayon précis.
 *
 * La RECHERCHE et le TRI en cours sont conservés quand on change de
 * catégorie : un visiteur qui a tapé « sac » puis filtré sur « Accessoires »
 * n'a pas à retaper « sac ». En revanche la PAGE est remise à 1 (changer de
 * rayon en restant en page 4 d'un filtre précédent n'a aucun sens).
 */
export interface CategoryFilterItem {
  id: string;
  slug: string;
  name: string;
  productCount: number;
}

export function CategoryFilters({
  categories,
  activeSlug,
  query,
  sort,
  totalCount,
}: {
  categories: CategoryFilterItem[];
  /** Slug de la catégorie affichée, `null` sur `/products`. */
  activeSlug: string | null;
  query: string;
  sort: CatalogSort;
  /** Nombre de produits toutes catégories confondues (pastille « tout »). */
  totalCount: number;
}) {
  const allActive = activeSlug === null;

  return (
    <nav className="filters enter enter-2" aria-label="Filtrer par catégorie">
      <Link
        href={buildCatalogHref("/products", { query, sort })}
        className={allActive ? "filters__pill filters__pill--active" : "filters__pill"}
        aria-current={allActive ? "true" : undefined}
      >
        Tout le catalogue
        <span className="filters__count">{totalCount}</span>
      </Link>
      {categories.map((category) => {
        const active = category.slug === activeSlug;
        return (
          <Link
            key={category.id}
            href={buildCatalogHref(`/categorie/${category.slug}`, { query, sort })}
            className={active ? "filters__pill filters__pill--active" : "filters__pill"}
            aria-current={active ? "true" : undefined}
          >
            {category.name}
            <span className="filters__count">{category.productCount}</span>
          </Link>
        );
      })}
    </nav>
  );
}
