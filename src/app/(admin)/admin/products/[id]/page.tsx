import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import {
  getAdminProductDetail,
  listCategoryOptions,
  stockLevelLabel,
  stockLevelSymbol,
} from "@/server/admin-products";
import { ProductForm } from "@/ui/components/admin/product-form";
import { VariantStockForm } from "@/ui/components/admin/variant-stock-form";
import { Money } from "@/ui/components/money";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

/**
 * Fiche produit : édition des champs du produit, puis tableau des variantes avec
 * leur stock réel, réservé et disponible — et l'édition du stock par variante.
 */
export default async function AdminProductDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();

  const [product, categories] = await Promise.all([
    getAdminProductDetail(params.id),
    listCategoryOptions(),
  ]);
  if (!product) notFound();

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">{product.name}</h1>
          <p className="admin-page__sub">
            {product.categoryName} · <span className="num">/{product.slug}</span> · modifié le{" "}
            {formatDateTime(product.updatedAt)}
          </p>
        </div>
        <Link href="/admin/products" className="btn btn-secondary">
          ← Tous les produits
        </Link>
      </div>

      <section className="card enter enter-2">
        <h2 className="card__title">Fiche produit</h2>
        <ProductForm
          product={{
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            categoryId: product.categoryId,
            active: product.active,
          }}
          categories={categories}
        />
      </section>

      <section className="admin-section enter enter-3">
        <div className="admin-section__head">
          <h2 className="admin-section__title">
            Variantes ({product.variants.length})
          </h2>
          <Link href="/admin/stock">Vue stock consolidée →</Link>
        </div>

        {product.variants.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__emoji" aria-hidden>
              🎨
            </span>
            <p className="empty-state__title">Aucune variante</p>
            <p className="empty-state__text">
              Ce produit n&apos;a ni taille, ni couleur, ni SKU : il n&apos;est donc pas
              vendable. Ajoutez au moins une variante pour le mettre en vente.
            </p>
            <div className="empty-state__actions">
              <Link href="/admin/products" className="btn btn-secondary">
                Retour aux produits
              </Link>
            </div>
          </div>
        ) : (
          <div className="data-table__wrap">
            <table className="data-table">
              <caption className="sr-only">
                Variantes de {product.name} : SKU, attributs, prix et stock
              </caption>
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Nom</th>
                  <th scope="col">Attributs</th>
                  <th scope="col" className="data-table__cell--right">
                    Prix
                  </th>
                  <th scope="col" className="data-table__cell--right">
                    Stock réel
                  </th>
                  <th scope="col" className="data-table__cell--right">
                    Réservé
                  </th>
                  <th scope="col" className="data-table__cell--right">
                    Disponible
                  </th>
                  <th scope="col">Niveau</th>
                  <th scope="col">Modifier le stock</th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((variant) => (
                  <tr
                    key={variant.id}
                    className={
                      variant.level === "out"
                        ? "data-table__row--out"
                        : variant.level === "low"
                          ? "data-table__row--low"
                          : undefined
                    }
                  >
                    <td className="num">{variant.sku}</td>
                    <td>{variant.name}</td>
                    <td>{variant.attributesLabel}</td>
                    <td className="data-table__cell--right money">
                      <Money cents={variant.priceCents} />
                    </td>
                    <td className="data-table__cell--right num">{variant.quantity}</td>
                    <td className="data-table__cell--right num">{variant.reserved}</td>
                    <td className="data-table__cell--right num">{variant.available}</td>
                    <td>
                      <span
                        className={
                          variant.level === "ok"
                            ? "badge badge-paid"
                            : variant.level === "low"
                              ? "badge badge-pending"
                              : "badge badge-cancelled"
                        }
                      >
                        <span aria-hidden>{stockLevelSymbol(variant.level)}</span>
                        {stockLevelLabel(variant.level)}
                      </span>
                    </td>
                    <td>
                      <VariantStockForm
                        variantId={variant.id}
                        sku={variant.sku}
                        quantity={variant.quantity}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
