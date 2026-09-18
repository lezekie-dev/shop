import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import { listAdminProducts } from "@/server/admin-products";
import { DataTable, RowChevron } from "@/ui/components/admin/data-table";
import { Money } from "@/ui/components/money";
import {
  IconProducts,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * Liste des produits — nom, catégorie, variantes, fourchette de prix et
 * disponibilité réelle. L'édition se fait sur la fiche produit.
 */
export default async function AdminProductsPage() {
  await requireAdmin();
  const products = await listAdminProducts();

  const activeCount = products.filter((product) => product.active).length;

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Produits</h1>
          <p className="admin-page__sub">
            {products.length} produit{products.length > 1 ? "s" : ""} — {activeCount} en ligne.
          </p>
        </div>
        <Link href="/admin/stock" className="btn btn-secondary">
          Voir le stock
        </Link>
      </div>

      <div className="enter enter-2">
        <DataTable
          caption="Catalogue produits avec variantes, prix et disponibilité"
          rows={products}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/admin/products/${row.id}`}
          rowLabel={(row) => `Modifier le produit ${row.name}`}
          rowClassName={(row) => (row.active ? undefined : "data-table__row--muted")}
          emptyState={
            <div className="empty-state">
              <IconProducts className="empty-state__icon" />
              <p className="empty-state__title">Aucun produit</p>
              <p className="empty-state__text">
                Votre catalogue est vide. Ajoutez vos produits et leurs variantes (taille,
                couleur) pour qu&apos;ils apparaissent dans la boutique.
              </p>
              <div className="empty-state__actions">
                <Link href="/products" className="btn btn-primary">
                  Voir le catalogue
                </Link>
              </div>
            </div>
          }
          columns={[
            {
              key: "name",
              header: "Produit",
              render: (row) => (
                <span>
                  {row.name}
                  <br />
                  <span className="admin-muted num">/{row.slug}</span>
                </span>
              ),
            },
            {
              key: "category",
              header: "Catégorie",
              render: (row) => <span className="badge badge-neutral">{row.categoryName}</span>,
            },
            {
              key: "variants",
              header: "Variantes",
              align: "right",
              nowrap: true,
              render: (row) => <span className="num">{row.variantCount}</span>,
            },
            {
              key: "price",
              header: "Prix",
              align: "right",
              nowrap: true,
              render: (row) => {
                if (row.priceMinCents === null || row.priceMaxCents === null) {
                  return <span className="admin-muted">Aucun prix</span>;
                }
                if (row.priceMinCents === row.priceMaxCents) {
                  return (
                    <span className="money">
                      <Money cents={row.priceMinCents} />
                    </span>
                  );
                }
                return (
                  <span className="money">
                    <Money cents={row.priceMinCents} /> – <Money cents={row.priceMaxCents} />
                  </span>
                );
              },
            },
            {
              key: "available",
              header: "Disponible",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="num">
                  {row.availableUnits}
                  {row.lowestAvailable !== null && row.lowestAvailable <= 5 ? (
                    <span className="badge badge-pending" style={{ marginLeft: "var(--sp-2)" }}>
                      <span aria-hidden>!</span>
                      {row.lowestAvailable <= 0 ? "Rupture" : "Stock faible"}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: "active",
              header: "Statut",
              render: (row) => (
                <span className={row.active ? "badge badge-paid" : "badge badge-neutral"}>
                  <span aria-hidden>{row.active ? "✓" : "○"}</span>
                  {row.active ? "En ligne" : "Masqué"}
                </span>
              ),
            },
            {
              key: "action",
              header: "Action",
              align: "right",
              nowrap: true,
              render: (row) => (
                <Link href={`/admin/products/${row.id}`}>
                  <RowChevron label={`Modifier ${row.name}`} />
                </Link>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
