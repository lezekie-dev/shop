import Link from "next/link";

import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import {
  IconMail,
  IconPhone,
  IconReturn,
  IconSeed,
  IconTruck,
} from "@/ui/components/icons";
import { ProductVisual } from "@/ui/components/product-visual";

export const dynamic = "force-dynamic";

/** Nom de la boutique — surchargeable par env pour un vrai marchand. */
const SHOP_NAME = process.env.SHOP_NAME ?? "Shop";

export default async function HomePage() {
  const [categories, featured, heroProduct, stats] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { products: { where: { active: true } } } },
        // Un visuel de couverture par catégorie, pris sur son premier produit
        // illustré : une carte de catégorie sans image fait pauvre.
        products: {
          where: { active: true },
          take: 1,
          orderBy: { createdAt: "desc" },
          include: { images: { orderBy: { position: "asc" }, take: 1 } },
        },
      },
    }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      // 5 et non 4 : le produit du hero est retiré ensuite, il en faut un de
      // réserve pour garder 4 cartes dans la grille.
      take: 5,
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
    // Produit mis en avant dans le hero : le PREMIER produit illustré. On
    // l'exclut ensuite des « dernières pièces » pour ne pas afficher deux fois
    // le même article sur l'accueil (défaut relevé à l'audit).
    prisma.product.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
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
    prisma.product.count({ where: { active: true } }),
  ]);

  const totalProducts = categories.reduce((acc, c) => acc + c._count.products, 0);
  const heroCover = heroProduct?.images[0] ?? null;
  const heroPrice = heroProduct?.variants[0]?.priceCents ?? null;
  // On retire le produit du hero des « dernières pièces » : le voir deux fois
  // sur la même page donne l'impression d'un catalogue qui tourne en rond.
  const latest = featured.filter((p) => p.id !== heroProduct?.id).slice(0, 4);

  return (
    <div className="shop-container">
      <div className="page">
        {/* ── Héros ─────────────────────────────────────────────
            L'accroche dit ce qu'on vend et à qui, pas « Bienvenue ».
            Le visuel du produit en avant est le premier argument de vente :
            sur mobile il passe avant le texte. */}
        <section className="hero enter enter-1">
          <div className="hero__visual">
            <div className="hero__visual-frame">
              <ProductVisual
                url={heroCover?.url ?? null}
                alt={heroCover?.alt ?? (heroProduct ? `Visuel de ${heroProduct.name}` : "Boutique")}
                productName={heroProduct?.name ?? SHOP_NAME}
                width={heroCover?.width ?? 800}
                height={heroCover?.height ?? 800}
                sizes="(max-width: 900px) 100vw, 45vw"
                priority
              />
              {heroProduct && (
                <div className="hero__visual-badge">
                  <span className="hero__visual-badge-label">En vedette</span>
                  <span className="hero__visual-badge-value">
                    {heroProduct.name}
                    {heroPrice !== null && (
                      <>
                        {" · "}
                        <span className="money">{formatMoneyEur(heroPrice)}</span>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="hero__inner">
            <p className="eyebrow">Sélection {new Date().getFullYear()}</p>
            <h1 className="hero__title">
              Des objets utiles, choisis un par un.
            </h1>
            <p className="hero__lead">
              Une petite sélection de vêtements et d&apos;accessoires en toile et coton.
              Commandez en trois minutes, payez comme vous voulez, recevez un numéro de suivi.
            </p>
            <div className="hero__actions">
              <Link href="/products" className="btn btn-primary">
                Découvrir la collection
              </Link>
              {heroProduct && (
                <Link href={`/products/${heroProduct.slug}`} className="btn btn-secondary">
                  Découvrir la pièce en vedette
                </Link>
              )}
            </div>
            <ul className="hero__points">
              <li>Aucun compte à créer</li>
              <li>Mobile Money ou virement</li>
              <li>Expédition suivie</li>
            </ul>
          </div>
        </section>

        {/* ── Nouveautés ─────────────────────────────────────── */}
        {latest.length > 0 && (
          <section className="section enter enter-2">
            <div className="section__head">
              <div>
                <p className="eyebrow">Arrivages</p>
                <h2 className="section__title">Les dernières pièces</h2>
              </div>
              <Link href="/products" className="section__link">
                Tout le catalogue →
              </Link>
            </div>
            <ul className="card-grid" data-count={latest.length}>
              {latest.map((p) => {
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

        {/* ── Catégories ─────────────────────────────────────── */}
        <section className="section enter enter-3">
          <div className="section__head">
            <div>
              <p className="eyebrow">Parcourir</p>
              <h2 className="section__title">Par catégorie</h2>
            </div>
            <p className="section__sub">
              <span className="num">{categories.length}</span> catégorie
              {categories.length > 1 ? "s" : ""} · <span className="num">{totalProducts}</span>{" "}
              produit{totalProducts > 1 ? "s" : ""}
            </p>
          </div>

          {categories.length === 0 ? (
            <div className="empty-state">
              <IconSeed className="empty-state__icon" />
              <p className="empty-state__title">Le catalogue est vide</p>
              <p className="empty-state__text">
                Aucune catégorie n&apos;a encore été créée. Dès qu&apos;une catégorie et ses
                produits seront publiés, ils apparaîtront ici.
              </p>
              <div className="empty-state__actions">
                <Link href="/products" className="btn btn-primary">
                  Explorer la boutique
                </Link>
              </div>
            </div>
          ) : (
            <ul className="category-grid" data-count={categories.length}>
              {categories.map((c) => {
                const cover = c.products[0]?.images[0] ?? null;
                const p = c.products[0];
                return (
                  <li key={c.id} className="category-card">
                    <Link href={`/categorie/${c.slug}`} className="category-card__link">
                      <div className="category-card__media">
                        <ProductVisual
                          url={cover?.url ?? null}
                          alt={cover?.alt ?? (p ? `Visuel de ${p.name}` : `Catégorie ${c.name}`)}
                          productName={p?.name ?? c.name}
                          width={cover?.width ?? 800}
                          height={cover?.height ?? 800}
                          sizes="(max-width: 640px) 100vw, 320px"
                        />
                      </div>
                      <div className="category-card__body">
                        <h3 className="category-card__title">{c.name}</h3>
                        <p className="category-card__meta">
                          <span className="num">{c._count.products}</span> produit
                          {c._count.products > 1 ? "s" : ""}
                          <span className="category-card__arrow" aria-hidden>
                            →
                          </span>
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Réassurance ────────────────────────────────────── */}
        <section className="assurance enter enter-4">
          <div className="assurance__item">
            <IconTruck />
            <div>
              <p className="assurance__title">Expédition suivie</p>
              <p className="assurance__text">
                Un numéro de suivi vous est envoyé dès l&apos;expédition.
              </p>
            </div>
          </div>
          <div className="assurance__item">
            <IconPhone />
            <div>
              <p className="assurance__title">Mobile Money accepté</p>
              <p className="assurance__text">
                Orange Money, MTN MoMo, ou virement bancaire.
              </p>
            </div>
          </div>
          <div className="assurance__item">
            <IconReturn />
            <div>
              <p className="assurance__title">Retour sous 14 jours</p>
              <p className="assurance__text">
                Un article ne convient pas ? Il est repris sans discussion.
              </p>
            </div>
          </div>
          <div className="assurance__item">
            <IconMail />
            <div>
              <p className="assurance__title">Commande sans compte</p>
              <p className="assurance__text">
                Votre commande se suit depuis l&apos;email de confirmation.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
