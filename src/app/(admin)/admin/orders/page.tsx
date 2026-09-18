import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import {
  ORDERS_PAGE_SIZE,
  buildOrdersHref,
  countOrdersByStatus,
  listAdminOrders,
  parsePage,
  parseStatusFilter,
} from "@/server/admin-orders";
import { DataTable, RowChevron } from "@/ui/components/admin/data-table";
import {
  ORDER_STATUS_ORDER,
  OrderStatusBadge,
  orderStatusLabel,
} from "@/ui/components/admin/order-status-badge";
import { PaymentMethodBadge } from "@/ui/components/admin/payment-method-badge";
import { Money } from "@/ui/components/money";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

type SearchParams = { status?: string; page?: string };

/**
 * Liste des commandes — filtre par statut (`?status=`) et pagination (`?page=`).
 *
 * Les filtres sont de vrais liens : l'état de la liste est dans l'URL, donc
 * partageable, rechargeable et compatible avec le bouton « précédent ».
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();

  const status = parseStatusFilter(searchParams.status);
  const requestedPage = parsePage(searchParams.page);

  const [{ rows, meta }, counts] = await Promise.all([
    listAdminOrders({ status, page: requestedPage }),
    countOrdersByStatus(),
  ]);

  const totalAll = ORDER_STATUS_ORDER.reduce((acc, s) => acc + counts[s], 0);

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Commandes</h1>
          <p className="admin-page__sub">
            {totalAll} commande{totalAll > 1 ? "s" : ""} au total
            {status ? ` — filtrées sur « ${orderStatusLabel(status)} »` : ""}.
          </p>
        </div>
      </div>

      <nav className="filters enter enter-2" aria-label="Filtrer par statut">
        <Link
          href={buildOrdersHref(null, 1)}
          className={status === null ? "filters__pill filters__pill--active" : "filters__pill"}
          aria-current={status === null ? "true" : undefined}
        >
          Tous les statuts
          <span className="filters__count">{totalAll}</span>
        </Link>
        {ORDER_STATUS_ORDER.map((candidate) => {
          const active = status === candidate;
          return (
            <Link
              key={candidate}
              href={buildOrdersHref(candidate, 1)}
              className={active ? "filters__pill filters__pill--active" : "filters__pill"}
              aria-current={active ? "true" : undefined}
            >
              {orderStatusLabel(candidate)}
              <span className="filters__count">{counts[candidate]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="enter enter-3">
        <DataTable
          caption="Liste des commandes, de la plus récente à la plus ancienne"
          rows={rows}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/admin/orders/${row.id}`}
          rowLabel={(row) => `Ouvrir la commande ${row.number}`}
          emptyState={
            status === null ? (
              <div className="empty-state">
                <span className="empty-state__emoji" aria-hidden>
                  🧾
                </span>
                <p className="empty-state__title">Aucune commande</p>
                <p className="empty-state__text">
                  Aucune commande n&apos;a encore été passée. Partagez votre catalogue : dès la
                  première vente, elle apparaîtra ici avec son statut et son paiement.
                </p>
                <div className="empty-state__actions">
                  <Link href="/products" className="btn btn-primary">
                    Voir le catalogue
                  </Link>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-state__emoji" aria-hidden>
                  🔎
                </span>
                <p className="empty-state__title">
                  Aucune commande avec ce statut
                </p>
                <p className="empty-state__text">
                  Aucune commande n&apos;est actuellement « {orderStatusLabel(status)} ». Le
                  filtre est actif : affichez tous les statuts pour retrouver vos commandes.
                </p>
                <div className="empty-state__actions">
                  <Link href={buildOrdersHref(null, 1)} className="btn btn-primary">
                    Voir tous les statuts
                  </Link>
                </div>
              </div>
            )
          }
          columns={[
            {
              key: "number",
              header: "Numéro",
              nowrap: true,
              render: (row) => <span className="num">{row.number}</span>,
            },
            {
              key: "date",
              header: "Date",
              nowrap: true,
              render: (row) => <span className="num">{formatDateTime(row.placedAt)}</span>,
            },
            {
              key: "customer",
              header: "Client",
              render: (row) => (
                <span>
                  {row.customerName}
                  <br />
                  <span className="admin-muted">{row.customerEmail}</span>
                </span>
              ),
            },
            {
              key: "total",
              header: "Total",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="money">
                  <Money cents={row.totalCents} currency={row.currency} />
                </span>
              ),
            },
            {
              key: "payment",
              header: "Paiement",
              render: (row) => <PaymentMethodBadge provider={row.paymentProvider} />,
            },
            {
              key: "status",
              header: "Statut",
              render: (row) => <OrderStatusBadge status={row.status} />,
            },
            {
              key: "action",
              header: "Action",
              align: "right",
              nowrap: true,
              render: (row) => (
                <Link href={`/admin/orders/${row.id}`}>
                  <RowChevron label={`Ouvrir la commande ${row.number}`} />
                </Link>
              ),
            },
          ]}
        />
      </div>

      {meta.pageCount > 1 ? (
        <nav className="pagination enter enter-4" aria-label="Pagination des commandes">
          {meta.page > 1 ? (
            <Link className="btn btn-secondary" href={buildOrdersHref(status, meta.page - 1)}>
              ← Précédent
            </Link>
          ) : (
            <span className="btn btn-secondary" aria-disabled="true">
              ← Précédent
            </span>
          )}
          <span className="pagination__status">
            Page {meta.page} / {meta.pageCount} · {meta.total} commande
            {meta.total > 1 ? "s" : ""} · {ORDERS_PAGE_SIZE} par page
          </span>
          {meta.page < meta.pageCount ? (
            <Link className="btn btn-secondary" href={buildOrdersHref(status, meta.page + 1)}>
              Suivant →
            </Link>
          ) : (
            <span className="btn btn-secondary" aria-disabled="true">
              Suivant →
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
