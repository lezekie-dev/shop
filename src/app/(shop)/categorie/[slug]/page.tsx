import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildCatalogHref,
  CATALOG_SCAN_LIMIT,
  normalizeQuery,
  parseCatalogSort,
  parsePageNumber,
} from "@/domain/catalog";
import { loadCategoryNav, loadCategoryPage } from "@/server/catalog";
import { CatalogPagination } from "@/ui/components/catalog-pagination";
import { CatalogSortLinks } from "@/ui/components/catalog-sort-links";
import { CategoryFilters } from "@/ui/components/category-filters";
import { IconSearch, IconSeed } from "@/ui/components/icons";
import { ProductCardGrid } from "@/ui/components/product-card-grid";

export const dynamic = "force-dynamic";

type CatalogSearchParams = Record<string, string | string[] | undefined>;

/**
 * Page d'une catégorie — la « porte d'entrée » d'un rayon.
 *
 * POURQUOI une page dédiée plutôt qu'un filtre `?category=` sur `/products` :
 * une catégorie est une entité commerciale (elle a un nom, un ordre
 * d'affichage voulu par le marchand, ses propres produits), pas un paramètre
 * d'affichage. Elle mérite son URL, son titre et sa place dans la navigation
 * de l'en-tête.
 *
 * Slug inconnu → 404 : on ne rend pas une page vide « tout le catalogue » à la
 * place, sinon un lien mort devient un lien valide et les moteurs indexent des
 * pages creuses.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: CatalogSearchParams;
}) {
  const query = normalizeQuery(searchParams.q);
  const sort = parseCatalogSort(searchParams.tri);
  const page = parsePageNumber(searchParams.page);

  const [result, categories] = await Promise.all([
    loadCategoryPage(params.slug, { query, sort, page }),
    loadCategoryNav(),
  ]);

  if (result === null) {
    notFound();
  }

  const { category, view, scanTruncated } = result;
  const isSearch = view.query !== "";
  const totalAll = categories.reduce((acc, item) => acc + item.productCount, 0);
  const neighbours = categories
    .filter((item) => item.slug !== category.slug && item.productCount > 0)
    .slice(0, 2);

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          {/* Fil d'Ariane : depuis une catégorie, revenir au catalogue complet
              est LE geste le plus fréquent après avoir regardé les produits. */}
          <nav className="breadcrumb" aria-label="Fil d'Ariane">
            <Link href="/products" className="breadcrumb__link">
              Boutique
            </Link>
            <span className="breadcrumb__sep" aria-hidden>
              /
            </span>
            <span className="muted">{category.name}</span>
          </nav>
          <p className="eyebrow">Catégorie</p>
          <h1 className="page__title">{category.name}</h1>
          {/* Le modèle `Category` ne porte pas de champ `description` : plutôt
              que d'inventer une migration, la présentation du rayon est
              calculée à partir du catalogue réel (nombre de produits publiés)
              et des engagements de la boutique — jamais de texte creux. */}
          <p className="page__sub">
            {isSearch ? (
              <>
                Recherche « {view.query} » dans les <span className="num">{category.name}</span>.
              </>
            ) : (
              <>
                <span className="num">{view.total}</span> produit{view.total > 1 ? "s" : ""} publié
                {view.total > 1 ? "s" : ""} dans ce rayon. Sélection choisie une par une, expédition
                suivie, paiement Mobile Money ou virement.
              </>
            )}
          </p>
        </div>
      </div>

      <CategoryFilters
        categories={categories}
        activeSlug={category.slug}
        query={view.query}
        sort={sort}
        totalCount={totalAll}
      />

      {view.total > 0 && (
        <div className="toolbar enter enter-3">
          <p className="toolbar__count">
            {isSearch ? (
              <>
                <span className="num">{view.total}</span> résultat{view.total > 1 ? "s" : ""} dans
                cette catégorie
              </>
            ) : (
              <>
                <span className="num">{view.firstIndex}</span>–
                <span className="num">{view.lastIndex}</span> sur{" "}
                <span className="num">{view.total}</span> produit{view.total > 1 ? "s" : ""}
              </>
            )}
          </p>
          {view.total > 1 && (
            <CatalogSortLinks
              basePath={`/categorie/${category.slug}`}
              query={view.query}
              sort={sort}
            />
          )}
        </div>
      )}

      {scanTruncated && (
        <p className="note">
          Catalogue volumineux : seuls les {CATALOG_SCAN_LIMIT} produits les plus récents sont
          parcourus. Affinez la recherche.
        </p>
      )}

      {view.total === 0 ? (
        isSearch ? (
          <div className="empty-state">
            <IconSearch className="empty-state__icon" />
            <p className="empty-state__title">
              Aucun produit de {category.name} ne correspond à « {view.query} »
            </p>
            <p className="empty-state__text">
              La recherche a porté sur les produits de cette catégorie uniquement. Le produit est
              peut-être rangé dans une autre catégorie — la recherche globale le trouvera.
            </p>
            <div className="empty-state__actions">
              <Link
                href={buildCatalogHref("/products", { query: view.query })}
                className="btn btn-secondary"
              >
                Chercher dans tout le catalogue
              </Link>
              <Link href={`/categorie/${category.slug}`} className="btn btn-primary">
                Voir les {category.name}
              </Link>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <IconSeed className="empty-state__icon" />
            <p className="empty-state__title">Cette catégorie est encore vide</p>
            <p className="empty-state__text">
              Aucun produit publié dans {category.name} pour le moment. Le reste du catalogue est
              déjà en ligne — les autres rayons sont peut-être mieux fournis.
            </p>
            <div className="empty-state__actions">
              <Link href="/products" className="btn btn-primary">
                Voir tout le catalogue
              </Link>
              {neighbours.map((item) => (
                <Link
                  key={item.id}
                  href={`/categorie/${item.slug}`}
                  className="btn btn-secondary"
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        )
      ) : (
        <>
          <ProductCardGrid items={view.items} priority />
          <CatalogPagination
            basePath={`/categorie/${category.slug}`}
            query={view.query}
            sort={sort}
            page={view.page}
            pageCount={view.pageCount}
          />
        </>
      )}
    </div>
  );
}
