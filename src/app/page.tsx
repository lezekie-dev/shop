import Link from "next/link";

import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { ProductVisual } from "@/ui/components/product-visual";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categories, featured] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { products: { where: { active: true } } },
        },
      },
    }),
    // Les derniers produits publiés, avec leur visuel de couverture et leur
    // prix d'entrée : c'est ce qui donne envie de cliquer depuis l'accueil.
    prisma.product.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: {
        category: true,
        images: { orderBy: { position: "asc" }, take: 1 },
        variants: {
          where: { active: true },
          orderBy: { priceCents: "asc" },
          select: { priceCents: true },
        },
      },
    }),
  ]);

  const totalProducts = categories.reduce((acc, c) => acc + c._count.products, 0);

  return (
    <div className="shop-container">
      <div className="page">
        <section className="hero enter enter-1">
          <p className="eyebrow">Boutique</p>
          <h1 className="hero__title">Bienvenue</h1>
          <p className="hero__lead">
            Une sélection de produits physiques, rangée par catégorie. Choisissez, ajoutez au
            panier, payez — sans créer de compte.
          </p>
          <div className="hero__actions">
            <Link href="/products" className="btn btn-primary">
              Explorer la boutique
            </Link>
          </div>
        </section>

        {featured.length > 0 && (
          <section className="section enter enter-2">
            <div className="section__head">
              <h2 className="section__title">Nouveautés</h2>
              <Link href="/products">Tout voir →</Link>
            </div>
            <ul className="card-grid" data-count={featured.length}>
              {featured.map((p) => {
                const cover = p.images[0] ?? null;
                const minPrice = p.variants[0]?.priceCents ?? null;
                return (
                  <li key={p.id} className="card card-interactive">
                    <Link href={`/products/${p.slug}`} className="card-link">
                      <ProductVisual
                        url={cover?.url ?? null}
                        alt={cover?.alt ?? `Visuel de ${p.name}`}
                        productName={p.name}
                        width={cover?.width ?? 800}
                        height={cover?.height ?? 800}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 260px"
                        priority
                      />
                    </Link>
                    <div className="card-body">
                      <p className="card-meta">{p.category.name}</p>
                      <Link href={`/products/${p.slug}`} className="card-title">
                        {p.name}
                      </Link>
                      {minPrice !== null && (
                        <p className="card-price">
                          <span className="money">{formatMoneyEur(minPrice)}</span>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="section enter enter-3">
          <div className="section__head">
            <h2 className="section__title">Catégories</h2>
            <p className="section__sub">
              <span className="num">{categories.length}</span> catégorie
              {categories.length > 1 ? "s" : ""} · <span className="num">{totalProducts}</span>{" "}
              produit{totalProducts > 1 ? "s" : ""}
            </p>
          </div>

          {categories.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__emoji" aria-hidden>
                🌱
              </span>
              <p className="empty-state__title">Aucune catégorie</p>
              <p className="empty-state__text">
                Le catalogue est encore vide : aucune catégorie n&apos;a été créée. Dès qu&apos;une
                catégorie et ses produits seront publiés, ils apparaîtront ici.
              </p>
              <div className="empty-state__actions">
                <Link href="/products" className="btn btn-primary">
                  Explorer la boutique
                </Link>
              </div>
            </div>
          ) : (
            <ul className="card-grid" data-count={categories.length}>
              {categories.map((c) => (
                <li key={c.id} className="card card-interactive">
                  <Link href={`/products?category=${c.slug}`} className="card-title">
                    {c.name}
                  </Link>
                  <p className="card-meta">
                    <span className="num">{c._count.products}</span> produit
                    {c._count.products > 1 ? "s" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}