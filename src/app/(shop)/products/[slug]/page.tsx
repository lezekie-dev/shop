import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoneyEur } from "@/domain/pricing";
import { AddToCartForm } from "@/ui/components/add-to-cart-form";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: {
      category: true,
      variants: {
        where: { active: true },
        orderBy: { priceCents: "asc" },
        include: { stock: true },
      },
    },
  });

  if (!product || !product.active) {
    notFound();
  }

  const variants = product.variants.map((v) => {
    const reserved = v.stock?.reserved ?? 0;
    const quantity = v.stock?.quantity ?? 0;
    const available = Math.max(0, quantity - reserved);
    return {
      id: v.id,
      name: v.name,
      priceCents: v.priceCents,
      available,
    };
  });

  const prices = variants.map((v) => v.priceCents);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const anyAvailable = variants.some((v) => v.available > 0);

  return (
    <div className="page">
      <div className="detail enter enter-1">
        <div className="detail__media">
          <span className="detail__media-emoji" aria-hidden>
            📦
          </span>
          <p>Visuel du produit à venir</p>
        </div>

        <div className="detail__info">
          <p className="eyebrow">{product.category.name}</p>
          <h1 className="page__title">{product.name}</h1>
          <p className="detail__desc">{product.description}</p>

          {minPrice !== null && (
            <p className="detail__price">
              {minPrice === maxPrice ? (
                <>
                  Prix : <span className="money money--lg">{formatMoneyEur(minPrice)}</span>
                </>
              ) : (
                <>
                  De <span className="money">{formatMoneyEur(minPrice)}</span> à{" "}
                  <span className="money">{formatMoneyEur(maxPrice ?? minPrice)}</span>
                </>
              )}
            </p>
          )}

          {!anyAvailable && variants.length > 0 && (
            <p className="line__meta">
              <span className="badge badge-cancelled">Rupture de stock</span>{" "}
              Toutes les variantes sont épuisées pour le moment.
            </p>
          )}

          {variants.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__emoji" aria-hidden>
                📦
              </span>
              <p className="empty-state__title">Aucune variante disponible</p>
              <p className="empty-state__text">
                Ce produit est publié mais aucune de ses variantes n&apos;est active : il
                n&apos;est pas encore commandable. Revenez bientôt, ou parcourez les autres
                produits du catalogue.
              </p>
              <div className="empty-state__actions">
                <Link href="/products" className="btn btn-secondary">
                  Voir le catalogue
                </Link>
              </div>
            </div>
          ) : (
            <div className="card">
              <h2 className="card__title">Choisir une variante</h2>
              <AddToCartForm variants={variants} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
