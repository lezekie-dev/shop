import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { canMarkPaid, canMarkShipped, getAdminOrderDetail } from "@/server/admin-orders";
import { OrderActions } from "@/ui/components/admin/order-actions";
import { OrderStatusBadge } from "@/ui/components/admin/order-status-badge";
import {
  PaymentMethodBadge,
  paymentMethodLabel,
} from "@/ui/components/admin/payment-method-badge";
import { Money } from "@/ui/components/money";
import { formatDateTime } from "@/ui/format";
import {
  IconTruck,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * Fiche commande : client, livraison, articles, paiement, expédition,
 * historique, et les actions de traitement réellement possibles.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();

  const order = await getAdminOrderDetail(params.id);
  if (!order) notFound();

  const actionable = canMarkPaid(order) || canMarkShipped(order);
  const lastPayment = order.payments[0];

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">
            Commande <span className="num">{order.number}</span>
          </h1>
          <p className="admin-page__sub">
            Passée le {formatDateTime(order.placedAt)} · <OrderStatusBadge status={order.status} />
          </p>
        </div>
        <Link href="/admin/orders" className="btn btn-secondary">
          ← Toutes les commandes
        </Link>
      </div>

      <div className="admin-columns enter enter-2">
        <div className="admin-stack">
          <Card title="Articles">
            <div className="data-table__wrap">
              <table className="data-table">
                <caption className="sr-only">Articles de la commande {order.number}</caption>
                <thead>
                  <tr>
                    <th scope="col">Produit</th>
                    <th scope="col">Variante</th>
                    <th scope="col" className="data-table__cell--right">
                      Qté
                    </th>
                    <th scope="col" className="data-table__cell--right">
                      Prix unitaire
                    </th>
                    <th scope="col" className="data-table__cell--right">
                      Total ligne
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.productName}</td>
                      <td>{item.variantName}</td>
                      <td className="data-table__cell--right num">{item.quantity}</td>
                      <td className="data-table__cell--right money">
                        <Money cents={item.unitPriceCents} currency={order.currency} />
                      </td>
                      <td className="data-table__cell--right money">
                        <Money
                          cents={item.unitPriceCents * item.quantity}
                          currency={order.currency}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {order.items.length === 0 ? (
              <p className="admin-muted">Cette commande ne contient aucune ligne.</p>
            ) : null}
          </Card>

          <Card title="Client">
            <div className="kv">
              <Row label="Nom" value={order.customer.name} />
              <Row label="Email" value={order.customer.email} numeric />
              <Row label="Téléphone" value={order.customer.phone ?? "Non renseigné"} />
            </div>
          </Card>

          <Card title="Adresse de livraison">
            <p style={{ margin: 0 }}>
              {order.address.line1}
              {order.address.line2 ? (
                <>
                  <br />
                  {order.address.line2}
                </>
              ) : null}
              <br />
              {order.address.postalCode} {order.address.city}
              <br />
              {order.address.country}
            </p>
          </Card>

          <Card title="Historique d'expédition">
            {order.shipments.length === 0 ? (
              <div className="empty-state">
                <IconTruck className="empty-state__icon" />
                <p className="empty-state__title">Aucune expédition enregistrée</p>
                <p className="empty-state__text">
                  Aucun colis n&apos;a encore été créé pour cette commande. Renseignez le
                  transporteur et le numéro de suivi pour la marquer expédiée.
                </p>
              </div>
            ) : (
              <ul className="alert-list">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="alert-row">
                    <span>
                      <span className="alert-row__name">{shipment.carrier ?? "Transporteur —"}</span>
                      <br />
                      <span className="alert-row__meta">
                        Suivi <span className="num">{shipment.trackingNo ?? "—"}</span>
                      </span>
                    </span>
                    <span className="badge badge-neutral">
                      <span aria-hidden>➤</span>
                      {shipmentStatusLabel(shipment.status)}
                      {shipment.shippedAt ? ` · ${formatDateTime(shipment.shippedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="admin-stack">
          <Card title="Total">
            <div className="kv">
              <Row
                label="Sous-total"
                value={<Money cents={order.subtotalCents} currency={order.currency} />}
                numeric
              />
              <Row
                label="Livraison"
                value={<Money cents={order.shippingCents} currency={order.currency} />}
                numeric
              />
              <Row
                label="Total"
                value={<Money cents={order.totalCents} currency={order.currency} />}
                numeric
                strong
              />
            </div>
          </Card>

          <Card title="Paiement">
            <p style={{ marginTop: 0 }}>
              <PaymentMethodBadge provider={order.paymentProvider} />
            </p>
            <div className="kv">
              <Row
                label="Référence prestataire"
                value={order.paymentRef ?? "—"}
                numeric
              />
              {order.payments.map((payment) => (
                <Row
                  key={payment.id}
                  label={`${paymentMethodLabel(payment.provider)} — ${paymentStatusLabel(payment.status)}`}
                  value={<Money cents={payment.amountCents} currency={payment.currency} />}
                  numeric
                />
              ))}
            </div>
            {order.payments.length === 0 ? (
              <p className="admin-muted" style={{ marginTop: "var(--sp-3)" }}>
                Aucun paiement enregistré : la commande n&apos;a jamais atteint le prestataire.
              </p>
            ) : (
              <p className="admin-muted" style={{ marginTop: "var(--sp-3)" }}>
                Dernier mouvement le {lastPayment ? formatDateTime(lastPayment.createdAt) : "—"}.
              </p>
            )}
          </Card>

          <Card title="Cycle de vie">
            <ol className="timeline">
              <TimelineStep
                done
                symbol="🧾"
                label="Commande passée"
                date={order.placedAt}
              />
              <TimelineStep
                done={order.paidAt !== null}
                symbol="✓"
                label="Paiement encaissé"
                date={order.paidAt}
              />
              <TimelineStep
                done={order.shippedAt !== null}
                symbol="➤"
                label="Commande expédiée"
                date={order.shippedAt}
              />
              {order.cancelledAt ? (
                <TimelineStep
                  done
                  symbol="✕"
                  label="Commande annulée"
                  date={order.cancelledAt}
                />
              ) : null}
            </ol>
          </Card>

          <Card title="Actions">
            {actionable ? (
              <OrderActions
                orderId={order.id}
                number={order.number}
                status={order.status}
                paymentProvider={order.paymentProvider}
              />
            ) : (
              <p className="admin-muted">
                Aucune action manuelle n&apos;est disponible pour une commande au statut
                « {order.status} ». Les transitions de paiement viennent du prestataire.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="card__title">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  numeric = false,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  numeric?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="kv__row">
      <span className="kv__label">{label}</span>
      <span
        className={numeric ? "kv__value kv__value--num" : "kv__value"}
        style={strong ? { fontWeight: "var(--fw-bold)" } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function TimelineStep({
  done,
  symbol,
  label,
  date,
}: {
  done: boolean;
  symbol: string;
  label: string;
  date: Date | null;
}) {
  return (
    <li className={done ? "timeline__step timeline__step--done" : "timeline__step timeline__step--todo"}>
      <span className="timeline__marker" aria-hidden>
        {symbol}
      </span>
      <span>
        <span className="timeline__label">{label}</span>
        <br />
        <span className="timeline__date">
          {date ? formatDateTime(date) : done ? "—" : "En attente"}
        </span>
      </span>
    </li>
  );
}

function paymentStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "en attente";
    case "SUCCEEDED":
      return "réussi";
    case "FAILED":
      return "échoué";
    case "REFUNDED":
      return "remboursé";
    default:
      return status.toLowerCase();
  }
}

function shipmentStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "En préparation";
    case "IN_TRANSIT":
      return "En transit";
    case "DELIVERED":
      return "Livré";
    case "RETURNED":
      return "Retourné";
    default:
      return status;
  }
}
