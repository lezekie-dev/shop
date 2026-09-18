import Link from "next/link";

import { requireCapability } from "@/server/guards";
import { LOW_STOCK_THRESHOLD } from "@/server/admin-stats";
import {
  listStockOverview,
  stockLevelLabel,
  stockLevelSymbol,
  type StockLevel,
} from "@/server/admin-products";
import { DataTable, RowChevron } from "@/ui/components/admin/data-table";
import { Money } from "@/ui/components/money";
import {
  IconStock,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * Vue stock consolidée : toutes les variantes, les plus contraintes en tête.
 *
 * Les variantes sous le seuil sont mises en avant (fond teinté + badge), et le
 * bandeau d'en-tête annonce le nombre d'alertes avant qu'on ait à scroller.
 */
export default async function AdminStockPage() {
  // Stock = propriété du catalogue : capacité `products:read`, donc ADMIN seul.
  await requireCapability("products:read");
  const variants = await listStockOverview();

  const outOfStock = variants.filter((variant) => variant.level === "out").length;
  const lowStock = variants.filter((variant) => variant.level === "low").length;
  const availableUnits = variants.reduce((acc, variant) => acc + variant.available, 0);

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Stock</h1>
          <p className="admin-page__sub">
            {variants.length} variante{variants.length > 1 ? "s" : ""} · {availableUnits} unité
            {availableUnits > 1 ? "s" : ""} disponible{availableUnits > 1 ? "s" : ""} · seuil
            d&apos;alerte à {LOW_STOCK_THRESHOLD}.
          </p>
        </div>
        <Link href="/admin/products" className="btn btn-secondary">
          Voir les produits
        </Link>
      </div>

      {outOfStock + lowStock > 0 ? (
        <div className={outOfStock > 0 ? "notice" : "notice enter enter-2"}>
          <p className="notice__title">
            {outOfStock > 0
              ? `${outOfStock} variante(s) en rupture, ${lowStock} en stock faible`
              : `${lowStock} variante(s) sous le seuil de ${LOW_STOCK_THRESHOLD}`}
          </p>
          <p style={{ margin: 0 }}>
            {outOfStock > 0
              ? "Une variante en rupture n'est plus commandable : les lignes surlignées en rouge sont à réapprovisionner en priorité."
              : "Ces variantes partent bientôt : les lignes surlignées sont à réapprovisionner."}
          </p>
        </div>
      ) : null}

      <div className="enter enter-3">
        <DataTable
          caption="Stock consolidé de toutes les variantes"
          rows={variants}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/admin/products/${row.productId}`}
          rowLabel={(row) => `Modifier le produit ${row.productName}`}
          rowClassName={(row) =>
            row.level === "out"
              ? "data-table__row--out"
              : row.level === "low"
                ? "data-table__row--low"
                : undefined
          }
          emptyState={
            <div className="empty-state">
              <IconStock className="empty-state__icon" />
              <p className="empty-state__title">Aucune variante en stock</p>
              <p className="empty-state__text">
                Aucun produit n&apos;a encore de variante. Ajoutez les tailles, couleurs et SKU
                de vos produits pour pouvoir suivre votre stock ici.
              </p>
              <div className="empty-state__actions">
                <Link href="/admin/products" className="btn btn-primary">
                  Gérer les produits
                </Link>
                <Link href="/products" className="btn btn-secondary">
                  Voir le catalogue
                </Link>
              </div>
            </div>
          }
          columns={[
            {
              key: "product",
              header: "Produit",
              render: (row) => (
                <span>
                  {row.productName}
                  <br />
                  <span className="admin-muted">{row.name}</span>
                </span>
              ),
            },
            {
              key: "sku",
              header: "SKU",
              nowrap: true,
              render: (row) => <span className="num">{row.sku}</span>,
            },
            {
              key: "attributes",
              header: "Attributs",
              render: (row) => row.attributesLabel,
            },
            {
              key: "price",
              header: "Prix",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="money">
                  <Money cents={row.priceCents} />
                </span>
              ),
            },
            {
              key: "quantity",
              header: "Réel",
              align: "right",
              nowrap: true,
              render: (row) => <span className="num">{row.quantity}</span>,
            },
            {
              key: "reserved",
              header: "Réservé",
              align: "right",
              nowrap: true,
              render: (row) => <span className="num">{row.reserved}</span>,
            },
            {
              key: "available",
              header: "Disponible",
              align: "right",
              nowrap: true,
              render: (row) => <span className="num">{row.available}</span>,
            },
            {
              key: "level",
              header: "Niveau",
              render: (row) => {
                const level: StockLevel = row.level;
                return (
                  <span
                    className={
                      level === "ok"
                        ? "badge badge-paid"
                        : level === "low"
                          ? "badge badge-pending"
                          : "badge badge-cancelled"
                    }
                  >
                    <span aria-hidden>{stockLevelSymbol(level)}</span>
                    {stockLevelLabel(level)}
                  </span>
                );
              },
            },
            {
              key: "action",
              header: "Action",
              align: "right",
              nowrap: true,
              render: (row) => (
                <Link href={`/admin/products/${row.productId}`}>
                  <RowChevron label={`Modifier ${row.productName}`} />
                </Link>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
