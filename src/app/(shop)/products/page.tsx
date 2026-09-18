import Link from "next/link";

import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { ProductVisual } from "@/ui/components/product-visual";
import {
  IconSearch,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

type Search = { category?: string };

export default async function ProductsListPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const categorySlug = searchParams.category;

  // Les catégories servent à la fois de filtre et de surtitre de page : une
  // seule requête pour les deux usages.
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: {
        active: true,
        ...(categorySlug
          ? { category: { slug: categorySlug } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        category: true,
        images: { orderBy: { position: "asc" }, take: 1 },
        variants: {
          where: { active: true },
          orderBy: { priceCents: "asc" },
        },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: { where: { active: true } } } },
      },
    }),
  ]);

  const items = products
    .map((p) => {
      const minPrice = p.variants.reduce<number | null>(
        (acc, v) => (acc === null || v.priceCents < acc ? v.priceCents : acc),
        null,
      );
      return { product: p, minPrice };
    })
    .sort((a, b) => {
      const av = a.minPrice ?? Number.MAX_SAFE_INTEGER;
      const bv = b.minPrice ?? Number.MAX_SAFE_INTEGER;
      return av - bv;
    });

  const activeCategory = categorySlug
    ? categories.find((c) => c.slug === categorySlug) ?? null
    : null;
  const totalAll = categories.reduce((acc, c) => acc + c._count.products, 0);
  const filtered = Boolean(categorySlug);

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">{filtered ? "Catégorie" : "Tout le catalogue"}</p>
          <h1 className="page__title">{activeCategory ? activeCategory.name : "Catalogue"}</h1>
          <p className="page__sub">
            <span className="num">{items.length}</span> produit
            {items.length > 1 ? "s" : ""}
            {filtered ? " dans cette catégorie" : ` sur ${totalAll}`}. Livraison suivie,
            paiement Mobile Money ou virement.
          </p>
        </div>
      </div>

      <nav className="filters enter enter-2" aria-label="Filtrer par catégorie">
        <Link
          href="/products"
          className={filtered ? "filters__pill" : "filters__pill filters__pill--active"}
          aria-current={filtered ? undefined : "true"}
        >
          Toutes les catégories
          <span className="filters__count">{totalAll}</span>
        </Link>
        {categories.map((c) => {
          const active = c.slug === categorySlug;
          return (
            <Link
              key={c.id}
              href={`/products?category=${c.slug}`}
              className={active ? "filters__pill filters__pill--active" : "filters__pill"}
              aria-current={active ? "true" : undefined}
            >
              {c.name}
              <span className="filters__count">{c._count.products}</span>
            </Link>
          );
        })}
      </nav>

      <div className="toolbar enter enter-3">
        <p className="toolbar__count">
          <span className="num">{items.length}</span> résultat{items.length > 1 ? "s" : ""} affiché
          {items.length > 1 ? "s" : ""}
        </p>
        <p className="toolbar__sort">Tri : prix croissant</p>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <IconSearch className="empty-state__icon" />
          <p className="empty-state__title">
            {filtered ? "Aucun produit dans cette catégorie" : "Aucun produit"}
          </p>
          <p className="empty-state__text">
            {filtered
              ? "Cette catégorie ne contient encore aucun produit actif. Les autres catégories sont peut-être mieux fournies."
              : "Le catalogue est vide pour le moment. Revenez bientôt : de nouveaux produits seront publiés ici."}
          </p>
          <div className="empty-state__actions">
            {filtered ? (
              <Link href="/products" className="btn btn-primary">
                Voir tout le catalogue
              </Link>
            ) : (
              <Link href="/" className="btn btn-secondary">
                Retour à l&apos;accueil
              </Link>
            )}
          </div>
        </div>
      ) : (
        <ul className="card-grid enter enter-3" data-count={items.length}>
          {items.map(({ product, minPrice }) => {
            const cover = product.images[0] ?? null;
            return (
              <li key={product.id} className="card card-interactive">
                <Link href={`/products/${product.slug}`} className="card-link">
                  <ProductVisual
                    url={cover?.url ?? null}
                    alt={cover?.alt ?? `Visuel de ${product.name}`}
                    productName={product.name}
                    width={cover?.width ?? 800}
                    height={cover?.height ?? 800}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 320px"
                  />
                </Link>
                <div className="card-body">
                  <p className="card-meta">{product.category.name}</p>
                  <Link href={`/products/${product.slug}`} className="card-title">
                    {product.name}
                  </Link>
                  <p className="card-price">
                    {minPrice !== null ? (
                      <>
                        À partir de <span className="money">{formatMoneyEur(minPrice)}</span>
                      </>
                    ) : (
                      "Prix indisponible"
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
