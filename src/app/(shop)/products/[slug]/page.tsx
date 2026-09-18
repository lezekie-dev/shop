import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoneyEur } from "@/domain/pricing";
import { AddToCartForm } from "@/ui/components/add-to-cart-form";
import { ProductVisual } from "@/ui/components/product-visual";
import { prisma } from "@/lib/db";
import {
  IconBox,
} from "@/ui/components/icons";

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
      images: { orderBy: { position: "asc" } },
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
    // La couleur est stockée dans `attributes` (JSON) : on l'extrait pour
    // pouvoir la comparer au visuel affiché.
    const attrs = (v.attributes ?? {}) as { color?: unknown };
    const color = typeof attrs.color === "string" ? attrs.color : null;
    return {
      id: v.id,
      name: v.name,
      priceCents: v.priceCents,
      available,
      color,
    };
  });

  // ── Cohérence visuel / variante ───────────────────────────────
  // Le visuel d'un produit est nommé d'après sa couleur (`casquette-noir.png`).
  // Sans cette déduction, le formulaire présélectionnait la première variante
  // disponible (« Beige ») alors que l'image montrait un article NOIR : le
  // client ne savait pas ce qu'il achetait. On cherche donc la variante dont
  // la couleur correspond au nom du fichier, et on la met en avant.
  const coverUrl = product.images[0]?.url ?? "";
  const imageBase = coverUrl.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
  const variantFromImageId =
    variants.find((v) => v.color && imageBase.endsWith(`-${v.color}`))?.id ?? null;

  const prices = variants.map((v) => v.priceCents);
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const anyAvailable = variants.some((v) => v.available > 0);

  return (
    <div className="page">
      <div className="detail enter enter-1">
        <div className="detail__media">
          <ProductVisual
            url={product.images[0]?.url ?? null}
            alt={product.images[0]?.alt ?? `Visuel de ${product.name}`}
            productName={product.name}
            width={product.images[0]?.width ?? 800}
            height={product.images[0]?.height ?? 800}
            sizes="(max-width: 900px) 100vw, 46vw"
            priority
          />
        </div>

        <div className="detail__info">
          {/* Fil d'Ariane : permet de revenir à la catégorie d'un clic, et
              donne un repère de profondeur dans le catalogue. */}
          <nav className="breadcrumb" aria-label="Fil d'Ariane">
            <Link href="/products" className="breadcrumb__link">
              Boutique
            </Link>
            <span className="breadcrumb__sep" aria-hidden>
              /
            </span>
            <Link
              href={`/categorie/${product.category.slug}`}
              className="breadcrumb__link"
            >
              {product.category.name}
            </Link>
          </nav>

          <h1 className="page__title">{product.name}</h1>
          <p className="detail__desc">{product.description}</p>

          {minPrice !== null && (
            <p className="detail__price">
              {minPrice === maxPrice ? (
                <span className="money money--lg">{formatMoneyEur(minPrice)}</span>
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
              <IconBox className="empty-state__icon" />
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
            <div className="card card--purchase">
              <h2 className="card__title">Choisir une variante</h2>
              <AddToCartForm variants={variants} defaultVariantId={variantFromImageId} />
              {/* Arguments de réassurance placés SOUS le bouton d'ajout : c'est
                  l'instant précis où l'hésitation se produit. */}
              <ul className="purchase-points">
                <li>Commande sans créer de compte</li>
                <li>Mobile Money (Orange, MTN) ou virement bancaire</li>
                <li>Expédition suivie, retour accepté sous 14 jours</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
