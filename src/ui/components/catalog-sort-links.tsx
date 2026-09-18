import Link from "next/link";

import { buildCatalogHref, CATALOG_SORTS, type CatalogSort } from "@/domain/catalog";

/**
 * Tri des résultats — des LIENS, pas un `<select>` piloté en JavaScript.
 *
 * POURQUOI : chaque tri a ainsi sa propre URL (`?tri=prix-asc`), partageable,
 * indexable, et il fonctionne sans JavaScript — un navigateur qui coupe le JS
 * pour économiser de la data en 3G ne perd pas le tri. Le coût : une
 * navigation serveur par changement de tri, sur une page déjà rendue au
 * serveur.
 *
 * Le tri est un `nav` de pastilles (`.filters__pill`, déjà partagé avec le
 * back-office) : sur mobile, une rangée de pastilles se parcourt au pouce,
 * là où un menu déroulant demande deux gestes précis.
 */

/** Libellés affichés, dans l'ordre de `CATALOG_SORTS`. */
const SORT_LABELS: Record<CatalogSort, string> = {
  recents: "Nouveautés",
  "prix-asc": "Prix croissant",
  "prix-desc": "Prix décroissant",
};

export function CatalogSortLinks({
  basePath,
  query,
  sort,
}: {
  /** `/products` ou `/categorie/<slug>` — on reste dans le contexte courant. */
  basePath: string;
  query: string;
  sort: CatalogSort;
}) {
  return (
    <nav className="filters" aria-label="Trier les résultats">
      <span className="eyebrow">Trier</span>
      {CATALOG_SORTS.map((option) => {
        const active = option === sort;
        return (
          <Link
            key={option}
            // Changer de tri RENVOIE À LA PAGE 1 : rester en page 3 d'un tri
            // qu'on vient de changer n'a aucun sens et donne l'impression que
            // le tri n'a rien fait.
            href={buildCatalogHref(basePath, { query, sort: option, page: 1 })}
            className={active ? "filters__pill filters__pill--active" : "filters__pill"}
            aria-current={active ? "true" : undefined}
          >
            {SORT_LABELS[option]}
          </Link>
        );
      })}
    </nav>
  );
}
