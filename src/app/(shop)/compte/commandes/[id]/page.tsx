import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoneyEur } from "@/domain/pricing";
import { requireCustomer } from "@/lib/customer-auth";
import { getCustomerOrderDetail } from "@/server/customer-orders";
import { Money } from "@/ui/components/money";
import { OrderProgress } from "@/ui/components/order-progress";
import { StatusBadge } from "@/ui/components/status-badge";
import { formatDateTime } from "@/ui/format";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_META,
  SHIPMENT_STATUS_LABELS,
  pendingPaymentHref,
} from "@/ui/payment-labels";

export const dynamic = "force-dynamic";

/**
 * Détail d'une commande + suivi d'expédition, pour le client connecté.
 *
 * L'id vient de l'URL : `getCustomerOrderDetail` le combine TOUJOURS au
 * `customerId` de la session. Une commande appartenant à un autre client
 * renvoie `null`, donc un 404 — jamais un 403, qui confirmerait l'existence de
 * la ressource à qui énumère des identifiants.
 *
 * Le jeton d'accès (`Order.accessToken`) n'est pas demandé ici : il reste le
 * moyen du client INVITÉ. Exiger les deux obligerait un client connecté à
 * conserver un lien de suivi pour voir sa propre commande.
 */
export default async function AccountOrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const customer = await requireCustomer(`/compte/commandes/${params.id}`);
  const order = await getCustomerOrderDetail(customer.id, params.id);
  if (!order) notFound();

  const deliveredAt = order.shipments.find((s) => s.deliveredAt !== null)?.deliveredAt ?? null;
  const shippedAt =
    order.shippedAt ?? order.shipments.find((s) => s.shippedAt !== null)?.shippedAt ?? null;
  const pendingPayment = order.status === "PENDING_PAYMENT";
  const instructionsHref = pendingPaymentHref(order.paymentProvider, order.paymentRef);
  const stopped = order.status === "CANCELLED" || order.status === "REFUNDED";

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">
            <Link href="/compte">Mes commandes</Link> · Commande
          </p>
          <h1 className="page__title">
            Commande <span className="num">{order.number}</span>
          </h1>
          <p className="page__sub">Passée le {formatDateTime(order.placedAt)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {pendingPayment && (
        <div className="notice">
          <p className="notice__title">En attente de paiement</p>
          <p>
            Cette commande n&apos;est pas encore réglée, elle sera préparée dès réception du
            paiement.
            {instructionsHref && (
              <>
                {" "}
                <Link href={instructionsHref}>Revoir les instructions de paiement</Link>.
              </>
            )}
          </p>
        </div>
      )}

      {stopped && (
        <div className="notice">
          <p className="notice__title">
            {order.status === "CANCELLED" ? "Commande annulée" : "Commande remboursée"}
          </p>
          <p>
            {order.status === "CANCELLED"
              ? "Le parcours ci-dessous s'est arrêté à l'étape atteinte, aucune suite n'est prévue."
              : "Le montant a été restitué : le parcours ci-dessous s'est arrêté."}
          </p>
        </div>
      )}

      <div className="split enter enter-2">
        <div className="section">
          <div className="card">
            <h2 className="card__title">Progression</h2>
            <OrderProgress
              placedAt={order.placedAt}
              paidAt={order.paidAt}
              shippedAt={shippedAt}
              deliveredAt={deliveredAt}
              status={order.status}
            />
          </div>

          <div className="card">
            <h2 className="card__title">Expédition</h2>
            {order.shipments.length === 0 ? (
              <p className="line__meta">
                Aucun colis expédié pour le moment. Vous recevrez un email dès la remise au
                transporteur.
              </p>
            ) : (
              <ul className="line-list">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="line line--stacked">
                    <div className="line__body">
                      <p className="line__article">
                        {shipment.carrier ?? "Transporteur non précisé"}
                      </p>
                      <p className="line__meta">
                        {SHIPMENT_STATUS_LABELS[shipment.status] ?? shipment.status}
                        {shipment.shippedAt ? (
                          <>
                            <br />
                            Expédié le {formatDateTime(shipment.shippedAt)}
                          </>
                        ) : null}
                        {shipment.deliveredAt ? (
                          <>
                            <br />
                            Livré le {formatDateTime(shipment.deliveredAt)}
                          </>
                        ) : null}
                      </p>
                      <div className="tracking">
                        <p className="line__meta">Numéro de suivi</p>
                        <p className="tracking__no num">
                          {shipment.trackingNo ?? "— à communiquer —"}
                        </p>
                        {shipment.trackingUrl && (
                          <a
                            className="tracking__carrier"
                            href={shipment.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Suivre le colis chez le transporteur ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2 className="card__title">Articles</h2>
            <ul className="line-list">
              {order.items.map((item) => (
                <li key={item.id} className="line">
                  <div className="line__media" aria-hidden>
                    📦
                  </div>
                  <div className="line__body">
                    <p className="line__article">{item.productName}</p>
                    <p className="line__meta">
                      {item.variantName} · Quantité <span className="num">{item.quantity}</span>
                    </p>
                    <div className="line__foot">
                      <span className="line__meta">
                        Prix unitaire{" "}
                        <span className="money">{formatMoneyEur(item.unitPriceCents)}</span>
                      </span>
                      <span className="line__total money">
                        {formatMoneyEur(item.lineTotalCents)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2 className="card__title">Adresses</h2>
            <p className="line__meta">
              <strong>Livraison</strong>
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? (
                <>
                  <br />
                  {order.shippingAddress.line2}
                </>
              ) : null}
              <br />
              {order.shippingAddress.postalCode} {order.shippingAddress.city}
              <br />
              {order.shippingAddress.country}
            </p>
            {order.billingAddress && !order.billingSameAsShipping && (
              <p className="line__meta">
                <strong>Facturation</strong>
                <br />
                {order.billingAddress.line1}
                <br />
                {order.billingAddress.postalCode} {order.billingAddress.city}
                <br />
                {order.billingAddress.country}
              </p>
            )}
            <p className="line__meta small muted">
              Le carnet d&apos;adresses ne modifie pas les commandes déjà passées.{" "}
              <Link href="/compte/adresses">Gérer mes adresses</Link>
            </p>
          </div>
        </div>

        <aside className="split__aside">
          <div className="card">
            <h2 className="card__title">Total</h2>
            <div className="summary">
              <div className="summary__row">
                <span className="summary__label">Sous-total</span>
                <span className="summary__value money">{formatMoneyEur(order.subtotalCents)}</span>
              </div>
              {order.discountCents > 0 && (
                <div className="summary__row">
                  <span className="summary__label">Remise</span>
                  <span className="summary__value money">
                    −{formatMoneyEur(order.discountCents)}
                  </span>
                </div>
              )}
              <div className="summary__row">
                <span className="summary__label">Livraison</span>
                <span className="summary__value money">{formatMoneyEur(order.shippingCents)}</span>
              </div>
              <div className="summary__row summary__row--total">
                <span className="summary__label">Total</span>
                <span className="money">{formatMoneyEur(order.totalCents)}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="card__title">Paiement</h2>
            <div className="summary">
              <div className="summary__row">
                <span className="summary__label">Méthode</span>
                <span className="summary__value">
                  {PAYMENT_METHOD_LABELS[order.paymentProvider] ?? order.paymentProvider}
                </span>
              </div>
              {order.payments.length === 0 ? (
                <p className="line__meta">Aucun règlement enregistré pour cette commande.</p>
              ) : (
                order.payments.map((payment) => {
                  const meta = PAYMENT_STATUS_META[payment.status];
                  return (
                    <div key={payment.id} className="summary__row">
                      <span className="summary__label money">
                        <Money cents={payment.amountCents} currency={payment.currency} />
                      </span>
                      <span className={meta.className} aria-label={`Paiement : ${meta.label}`}>
                        <span aria-hidden>{meta.symbol}</span>
                        {meta.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="section">
            <Link href="/compte" className="btn btn-secondary btn-block">
              Retour à mes commandes
            </Link>
            <Link href="/products" className="btn btn-primary btn-block">
              Continuer mes achats
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
