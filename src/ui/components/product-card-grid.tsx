import Link from "next/link";

import { formatMoneyEur } from "@/domain/pricing";
import { ProductVisual } from "@/ui/components/product-visual";

/**
 * Grille de cartes produit du catalogue.
 *
 * Composant PARTAGÉ entre `/products` et `/categorie/[slug]` : les deux pages
 * affichent la même carte, une seule définition évite qu'elles divergent
 * (l'une corrigée, l'autre oubliée).
 *
 * Le type est STRUCTUREL, pas importé de `server/` : la couche UI ne dépend
 * pas de la couche d'accès aux données, elle reçoit ce qu'on lui donne.
 */
export interface ProductCardItem {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
  /** Prix de la variante la moins chère, en minor units. `null` = aucune
   *  variante active → « Prix indisponible » plutôt qu'un 0 € mensonger. */
  minPriceCents: number | null;
  image: { url: string; alt: string; width: number | null; height: number | null } | null;
}

export function ProductCardGrid({
  items,
  /** Charge la PREMIÈRE image en priorité : c'est le LCP de la page. */
  priority = false,
}: {
  items: ProductCardItem[];
  priority?: boolean;
}) {
  return (
    <ul className="card-grid enter enter-3" data-count={items.length}>
      {items.map((item, index) => (
        <li key={item.id} className="card card-interactive">
          <Link href={`/products/${item.slug}`} className="card-link">
            <ProductVisual
              url={item.image?.url ?? null}
              alt={item.image?.alt ?? `Visuel de ${item.name}`}
              productName={item.name}
              // Dimensions stockées : sans elles, la page saute à l'arrivée de
              // chaque image (le défaut le plus visible en 3G).
              width={item.image?.width ?? 800}
              height={item.image?.height ?? 800}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 320px"
              priority={priority && index === 0}
            />
          </Link>
          <div className="card-body">
            <p className="card-meta">{item.categoryName}</p>
            <Link href={`/products/${item.slug}`} className="card-title">
              {item.name}
            </Link>
            <p className="card-price">
              {item.minPriceCents !== null ? (
                <>
                  À partir de <span className="money">{formatMoneyEur(item.minPriceCents)}</span>
                </>
              ) : (
                "Prix indisponible"
              )}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
