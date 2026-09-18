import Link from "next/link";

import { requireCustomer } from "@/lib/customer-auth";
import { listCustomerOrders } from "@/server/customer-orders";
import { StatusBadge } from "@/ui/components/status-badge";
import { formatDateTime } from "@/ui/format";
import { formatMoneyEur } from "@/domain/pricing";

export const dynamic = "force-dynamic";

/**
 * Tableau de bord « Mes commandes ».
 *
 * Les commandes viennent du `customerId` de la SESSION, jamais d'un paramètre
 * d'URL : c'est ce qui garantit qu'un client ne voit que son historique.
 */
export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const customer = await requireCustomer("/compte");
  const requested = Number.parseInt(searchParams.page ?? "1", 10);
  const { orders, page, pageCount, total } = await listCustomerOrders(customer.id, {
    page: Number.isFinite(requested) ? requested : 1,
  });

  const greeting = customer.firstName ?? customer.email;

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">Mon compte</p>
          <h1 className="page__title">Mes commandes</h1>
          <p className="page__sub">
            Bonjour {greeting} —{" "}
            {total === 0
              ? "aucune commande enregistrée pour cet email."
              : `${total} commande${total > 1 ? "s" : ""} rattachée${total > 1 ? "s" : ""} à votre compte.`}
          </p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="empty-state enter enter-2">
          <p className="empty-state__icon" aria-hidden>
            📦
          </p>
          <p className="empty-state__title">Pas encore de commande</p>
          <p className="empty-state__text">
            Les commandes passées avec l&apos;email <strong>{customer.email}</strong>, en invité
            comme en compte, apparaissent ici dès qu&apos;elles sont créées.
          </p>
          <div className="empty-state__actions">
            <Link href="/products" className="btn btn-primary">
              Découvrir le catalogue
            </Link>
          </div>
        </div>
      ) : (
        <div className="section enter enter-2">
          <ul className="line-list">
            {orders.map((order) => (
              <li key={order.id} className="line line--stacked">
                <div className="line__body">
                  <p className="line__article">
                    Commande <span className="num">{order.number}</span>
                  </p>
                  <p className="line__meta">
                    {formatDateTime(order.placedAt)} ·{" "}
                    {order.itemCount === 1 ? "1 article" : `${order.itemCount} articles`}
                    {order.shipment?.trackingNo ? (
                      <>
                        <br />
                        Suivi {order.shipment.carrier ?? "transporteur"} —{" "}
                        <span className="num">{order.shipment.trackingNo}</span>
                      </>
                    ) : null}
                  </p>
                  <div className="line__foot">
                    <StatusBadge status={order.status} />
                    <span className="line__total money">{formatMoneyEur(order.totalCents)}</span>
                  </div>
                </div>
                <div className="actions">
                  <Link href={`/compte/commandes/${order.id}`} className="btn btn-secondary">
                    Voir le détail
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          {pageCount > 1 && (
            <nav className="actions actions--between" aria-label="Pagination des commandes">
              {page > 1 ? (
                <Link href={`/compte?page=${page - 1}`} className="btn btn-secondary">
                  Précédent
                </Link>
              ) : (
                <span />
              )}
              <span className="small muted">
                Page <span className="num">{page}</span> sur <span className="num">{pageCount}</span>
              </span>
              {page < pageCount ? (
                <Link href={`/compte?page=${page + 1}`} className="btn btn-secondary">
                  Suivant
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      )}

      {total > 0 && (
        <p className="note enter enter-3">
          Une commande passée sur cette boutique sans vous connecter ? Utilisez le lien de suivi
          reçu par email, ou créez un compte avec le même email : votre historique sera rattaché.
        </p>
      )}
    </div>
  );
}
