import Link from "next/link";
import { notFound } from "next/navigation";

import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { Money } from "@/ui/components/money";
import { OrderProgress } from "@/ui/components/order-progress";
import { StatusBadge } from "@/ui/components/status-badge";
import { formatDateTime } from "@/ui/format";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_META,
  pendingPaymentHref,
} from "@/ui/payment-labels";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { token?: string };
}) {
  // Accès par jeton obligatoire : l'id seul n'ouvre plus rien. Sans jeton
  // valide on rend un 404, ce qui évite de confirmer l'existence de la
  // commande à un visiteur qui n'a pas le lien complet.
  const token = searchParams.token;
  const order = token
    ? await prisma.order.findFirst({
        where: { id: params.id, accessToken: token },
        include: {
          items: true,
          address: true,
          customer: { select: { email: true, firstName: true, lastName: true, phone: true } },
          payments: {
            select: { provider: true, status: true, amountCents: true, currency: true },
          },
          shipments: {
            select: { carrier: true, trackingNo: true, status: true, deliveredAt: true },
          },
          // Code promo consommé : la confirmation affiche la remise AVEC son
          // code (« Remise BIENVENUE −5,00 € »), pour que le client reconnaisse
          // l'offre qu'il a utilisée (AC E3).
          redemption: { include: { promoCode: { select: { code: true } } } },
        },
      })
    : null;

  if (!order) {
    notFound();
  }

  const deliveredAt = order.shipments.find((s) => s.deliveredAt !== null)?.deliveredAt ?? null;
  const stopped = order.status === "CANCELLED" || order.status === "REFUNDED";

  const tracking = order.shipments.find((s) => s.trackingNo !== null) ?? null;
  const pendingPayment = order.status === "PENDING_PAYMENT";
  const instructionsHref = pendingPaymentHref(order.paymentProvider, order.paymentRef);

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">Commande</p>
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
            Cette commande n&apos;est pas encore réglée, elle sera donc préparée dès réception du
            paiement.
            {instructionsHref && (
              <>
                {" "}
                <Link href={instructionsHref}>Revoir les instructions de paiement</Link>.
              </>
            )}{" "}
            Votre panier reste réservé pendant ce temps.
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
              ? "Cette commande a été annulée : le parcours ci-dessous s'est arrêté à l'étape atteinte, aucune suite n'est prévue."
              : "Cette commande a été remboursée : le montant a été restitué, le parcours ci-dessous s'est arrêté."}
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
              shippedAt={order.shippedAt}
              deliveredAt={deliveredAt}
              status={order.status}
            />
          </div>

          <div className="card">
            <h2 className="card__title">Articles</h2>
            <ul className="line-list">
              {order.items.map((i) => (
                <li key={i.id} className="line">
                  <div className="line__media" aria-hidden>
                    📦
                  </div>
                  <div className="line__body">
                    <p className="line__article">{i.productNameSnapshot}</p>
                    <p className="line__meta">
                      {i.variantNameSnapshot} · Quantité <span className="num">{i.quantity}</span>
                    </p>
                    <div className="line__foot">
                      <span className="line__meta">
                        Prix unitaire{" "}
                        <span className="money">{formatMoneyEur(i.unitPriceCents)}</span>
                      </span>
                      <span className="line__total money">
                        {formatMoneyEur(i.quantity * i.unitPriceCents)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2 className="card__title">Adresse de livraison</h2>
            <p className="line__meta">
              {order.customer.firstName} {order.customer.lastName}
              <br />
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
            <p className="line__meta">{order.customer.email}</p>
            {order.customer.phone && (
              <p className="line__meta num">{order.customer.phone}</p>
            )}
          </div>
        </div>

        <aside className="split__aside">
          <div className="card">
            <h2 className="card__title">Total</h2>
            <div className="summary">
              <div className="summary__row">
                <span className="summary__label">Sous-total</span>
                <span className="summary__value money">
                  {formatMoneyEur(order.subtotalCents)}
                </span>
              </div>
              {order.discountCents > 0 ? (
                <div className="summary__row">
                  <span className="summary__label">
                    Remise
                    {order.redemption ? (
                      <>
                        {" "}
                        <span className="num">{order.redemption.promoCode.code}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="summary__value money">
                    −{formatMoneyEur(order.discountCents)}
                  </span>
                </div>
              ) : null}
              <div className="summary__row">
                <span className="summary__label">Livraison</span>
                <span className="summary__value money">
                  {formatMoneyEur(order.shippingCents)}
                </span>
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
                order.payments.map((p, idx) => {
                  const meta = PAYMENT_STATUS_META[p.status];
                  return (
                    <div key={idx} className="summary__row">
                      <span className="summary__label">
                        <span className="money">
                          <Money cents={p.amountCents} currency={p.currency} />
                        </span>
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

          {tracking && (
            <div className="card">
              <h2 className="card__title">Suivi de colis</h2>
              <div className="tracking">
                <p className="line__meta">Transporteur</p>
                <p className="tracking__carrier">
                  {tracking.carrier ?? "Transporteur non précisé"}
                </p>
                <p className="line__meta">Numéro de suivi</p>
                <p className="tracking__no num">{tracking.trackingNo}</p>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="actions">
        <Link href="/products" className="btn btn-secondary">
          Continuer mes achats
        </Link>
        <Link href="/" className="btn btn-secondary">
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
