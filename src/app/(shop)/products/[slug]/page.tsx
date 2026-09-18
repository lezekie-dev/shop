import Link from "next/link";
import { notFound } from "next/navigation";

import { aggregateRatingJsonLd } from "@/domain/review";
import { formatMoneyEur } from "@/domain/pricing";
import { getProductRatingSummary, listPublishedReviews } from "@/server/reviews";
import { AddToCartForm } from "@/ui/components/add-to-cart-form";
import { ProductVisual } from "@/ui/components/product-visual";
import { ReviewsSection } from "@/ui/components/product-reviews";
import { prisma } from "@/lib/db";
import {
  IconBox,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/** Numéro de page d'avis (`?avis=2`), borné : une valeur absurde retombe sur 1. */
function parseReviewPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  /** Pagination des avis, indépendante de la fiche (F1). */
  searchParams?: { avis?: string };
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

  // ── Avis clients (chantier F, F1) ───────────────────────────────────
  // Deux lectures, et deux seulement : la synthèse (note + nombre) et UNE page
  // d'avis publiés. Le filtre `status: "APPROVED"` vit dans `src/server/reviews.ts`
  // — rien n'est filtré « après coup » ici, donc un avis en attente ne peut pas
  // se retrouver à l'écran par oubli d'un `if`.
  //
  // `summary === null` (aucun avis publié) ⇒ aucun bloc n'est rendu : ni note,
  // ni compteur, ni étoiles vides. C'est la règle explicite du PO, et elle est
  // portée par `ReviewsSection`, pas par un style.
  const reviewSummary = await getProductRatingSummary(product.id);
  const reviewsPage = reviewSummary
    ? await listPublishedReviews(product.id, { page: parseReviewPage(searchParams?.avis) })
    : null;
  const ratingLd = aggregateRatingJsonLd(reviewSummary);

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

          {/* ── Alerte de stock faible ──
              Reprise de la maquette : un encart ambre « Plus que N pièces »,
              placé AVANT le choix de variante. C'est le moment où le client
              hésite ; le prévenir maintenant lui évite de remplir son panier
              pour découvrir la rupture à l'étape suivante.
              Le total est la SOMME des variantes : annoncer « plus que 2 » en
              se basant sur une seule taille serait faux dès que les autres
              tailles sont en stock. */}
          {anyAvailable && (() => {
            const total = variants.reduce((acc, v) => acc + v.available, 0);
            if (total > 5) return null;
            return (
              <p className="stock-alert">
                <strong>Dernières pièces</strong>
                <span>
                  Il reste {total} exemplaire{total > 1 ? "s" : ""} en stock, toutes tailles
                  confondues.
                </span>
              </p>
            );
          })()}

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

      {/* Avis clients : le bloc n'existe QUE s'il y a au moins un avis publié.
          `reviewsPage` est non nul exactement quand `reviewSummary` l'est. */}
      {reviewSummary && reviewsPage ? (
        <div className="section enter enter-2" id="avis">
          <ReviewsSection
            productName={product.name}
            summary={reviewSummary}
            reviews={reviewsPage.reviews}
            page={reviewsPage.page}
            pageCount={reviewsPage.pageCount}
            productHref={`/products/${product.slug}`}
          />
        </div>
      ) : null}

      {/* Balisage structuré UNIQUEMENT s'il y a des avis publiés (F1) : un
          `AggregateRating` à zéro avis annonce à Google une note qui n'existe
          pas, et une donnée indexée ne se retire pas. Le contenu ne contient
          que des NOMBRES — aucun texte client n'entre dans ce bloc. */}
      {ratingLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              name: product.name,
              aggregateRating: ratingLd,
            }),
          }}
        />
      ) : null}
    </div>
  );
}
