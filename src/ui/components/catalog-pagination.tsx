import Link from "next/link";

import { buildCatalogHref, catalogPageLinks, type CatalogSort } from "@/domain/catalog";

/**
 * Pagination du catalogue — des liens numérotés, sans JavaScript.
 *
 * POURQUOI des pages plutôt qu'un bouton « charger plus » : chaque page a une
 * URL (`?page=2`), donc elle est partageable, indexable par les moteurs, et
 * elle survit à une connexion qui coupe au milieu du parcours — le scénario
 * normal en 3G. « Charger plus » demanderait du JavaScript client, un état, et
 * perdrait tout au rechargement.
 *
 * Renvoie `null` s'il n'y a qu'une seule page : une pagination « 1 sur 1 » est
 * du bruit qui laisse croire qu'on aurait pu rater des produits.
 */
export function CatalogPagination({
  basePath,
  query,
  sort,
  page,
  pageCount,
}: {
  basePath: string;
  query: string;
  sort: CatalogSort;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) => buildCatalogHref(basePath, { query, sort, page: target });
  const links = catalogPageLinks(page, pageCount);

  return (
    <nav className="toolbar" aria-label="Pagination">
      <p className="toolbar__count">
        Page <span className="num">{page}</span> sur <span className="num">{pageCount}</span>
      </p>
      <div className="filters">
        {page > 1 ? (
          <Link href={href(page - 1)} className="filters__pill" rel="prev">
            ← Précédent
          </Link>
        ) : (
          // Bouton désactivé rendu en `span` : un contrôle inactif qui reste
          // focusable au clavier est un piège, on ne le rend donc pas comme
          // un lien.
          <span className="filters__pill filters__pill--disabled" aria-disabled="true">
            ← Précédent
          </span>
        )}

        {links.map((link, index) =>
          link === "gap" ? (
            <span key={`gap-${index}`} className="filters__count" aria-hidden="true">
              …
            </span>
          ) : link === page ? (
            <span
              key={link}
              className="filters__pill filters__pill--active"
              aria-current="page"
              aria-label={`Page ${link}, page actuelle`}
            >
              {link}
            </span>
          ) : (
            <Link key={link} href={href(link)} className="filters__pill">
              {link}
            </Link>
          ),
        )}

        {page < pageCount ? (
          <Link href={href(page + 1)} className="filters__pill" rel="next">
            Suivant →
          </Link>
        ) : (
          <span className="filters__pill filters__pill--disabled" aria-disabled="true">
            Suivant →
          </span>
        )}
      </div>
    </nav>
  );
}
