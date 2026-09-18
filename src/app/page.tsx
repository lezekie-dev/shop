import Link from "next/link";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { products: { where: { active: true } } },
      },
    },
  });

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

        <section className="section enter enter-2">
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
            <ul className="card-grid">
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
