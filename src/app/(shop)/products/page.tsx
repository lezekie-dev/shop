import Link from "next/link";
import { redirect } from "next/navigation";

import {
  buildCatalogHref,
  CATALOG_SCAN_LIMIT,
  firstParam,
  normalizeQuery,
  parseCatalogSort,
  parsePageNumber,
} from "@/domain/catalog";
import { loadCatalog, loadCategoryNav } from "@/server/catalog";
import { CatalogPagination } from "@/ui/components/catalog-pagination";
import { CatalogSortLinks } from "@/ui/components/catalog-sort-links";
import { CategoryFilters } from "@/ui/components/category-filters";
import { IconSearch, IconSeed } from "@/ui/components/icons";
import { ProductCardGrid } from "@/ui/components/product-card-grid";

export const dynamic = "force-dynamic";

/**
 * Paramètres d'URL du catalogue. Les valeurs arrivent en `string` ou en
 * tableau (`?q=a&q=b`) : la normalisation se fait dans `domain/catalog`.
 */
type CatalogSearchParams = Record<string, string | string[] | undefined>;

/**
 * Catalogue complet — recherche, tri, pagination.
 *
 * Page 100 % serveur (aucun composant client) : sur une connexion 3G, chaque
 * kilo-octet de JavaScript compte plus que chaque kilo-octet de HTML. Tri et
 * pagination sont des liens, ils fonctionnent sans JS.
 */
export default async function ProductsListPage({
  searchParams,
}: {
  searchParams: CatalogSearchParams;
}) {
  const query = normalizeQuery(searchParams.q);
  const sort = parseCatalogSort(searchParams.tri);
  const page = parsePageNumber(searchParams.page);

  // Les liens « catégorie » HISTORIQUES (`/products?category=vetements`) ont
  // été remplacés par des pages dédiées (`/categorie/vetements`). Ils vivent
  // encore dans des favoris et des résultats de moteurs : on redirige plutôt
  // que de garder deux URLs pour le même contenu.
  const legacyCategory = firstParam(searchParams.category);
  if (legacyCategory !== undefined && legacyCategory !== "") {
    redirect(buildCatalogHref(`/categorie/${legacyCategory}`, { query, sort, page }));
  }

  const [{ view, scanTruncated }, categories] = await Promise.all([
    loadCatalog({ query, categorySlug: null, sort, page }),
    loadCategoryNav(),
  ]);

  const isSearch = view.query !== "";
  const totalAll = categories.reduce((acc, category) => acc + category.productCount, 0);
  // Suggestions proposées depuis l'état vide : seulement les catégories qui
  // contiennent réellement des produits, sinon on envoie le visiteur dans un
  // deuxième cul-de-sac.
  const suggestions = categories.filter((category) => category.productCount > 0).slice(0, 2);

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">{isSearch ? "Recherche" : "Tout le catalogue"}</p>
          <h1 className="page__title">
            {isSearch ? `Résultats pour « ${view.query} »` : "Catalogue"}
          </h1>
          <p className="page__sub">
            {isSearch ? (
              <>
                Recherche dans le nom <em>et</em> la description des produits publiés.
              </>
            ) : (
              <>
                <span className="num">{totalAll}</span> produit{totalAll > 1 ? "s" : ""} en ligne.
                Livraison suivie, paiement Mobile Money ou virement.
              </>
            )}
          </p>
        </div>
      </div>

      <CategoryFilters
        categories={categories}
        activeSlug={null}
        query={view.query}
        sort={sort}
        totalCount={totalAll}
      />

      {view.total > 0 && (
        <div className="toolbar enter enter-3">
          <p className="toolbar__count">
            {/* Le total est annoncé en toutes lettres : sur un catalogue
                filtré, « 12 résultats » sans total ne dit pas s'il en reste
                3 ou 300 derrière. */}
            <span className="num">{view.firstIndex}</span>–
            <span className="num">{view.lastIndex}</span> sur{" "}
            <span className="num">{view.total}</span> produit{view.total > 1 ? "s" : ""}
          </p>
          {view.total > 1 && (
            <CatalogSortLinks basePath="/products" query={view.query} sort={sort} />
          )}
        </div>
      )}

      {/* Limite assumée du tri en mémoire (cf. CATALOG_SCAN_LIMIT) : on la DIT
          au lieu de laisser croire que le catalogue a été parcouru en entier. */}
      {scanTruncated && (
        <p className="note">
          Catalogue volumineux : seuls les {CATALOG_SCAN_LIMIT} produits les plus récents sont
          parcourus. Affinez la recherche ou choisissez une catégorie.
        </p>
      )}

      {view.total === 0 ? (
        isSearch ? (
          <div className="empty-state">
            <IconSearch className="empty-state__icon" />
            <p className="empty-state__title">Aucun produit ne correspond à « {view.query} »</p>
            <p className="empty-state__text">
              Nous avons cherché dans le nom et la description de tous les produits publiés, sans
              rien trouver. Essayez un mot plus court (« sac » plutôt que « sac en toile
              imperméable »), vérifiez l&apos;orthographe — ou parcourez le catalogue autrement :
              il est petit, il se laisse explorer.
            </p>
            <div className="empty-state__actions">
              <Link href="/products" className="btn btn-primary">
                Voir tout le catalogue
              </Link>
              {suggestions.map((category) => (
                <Link
                  key={category.id}
                  href={`/categorie/${category.slug}`}
                  className="btn btn-secondary"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <IconSeed className="empty-state__icon" />
            <p className="empty-state__title">Le catalogue est vide</p>
            <p className="empty-state__text">
              Aucun produit n&apos;est publié pour le moment. Revenez bientôt : les nouveautés
              apparaissent ici dès leur mise en ligne.
            </p>
            <div className="empty-state__actions">
              <Link href="/" className="btn btn-secondary">
                Retour à l&apos;accueil
              </Link>
            </div>
          </div>
        )
      ) : (
        <>
          <ProductCardGrid items={view.items} priority />
          <CatalogPagination
            basePath="/products"
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
