import { cookies } from "next/headers";
import Link from "next/link";

import { CART_COOKIE_NAME, readCart } from "@/server/cart";
import { computeTotals } from "@/domain/cart";
import { formatMoneyEur } from "@/domain/pricing";
import { CheckoutForm, type CheckoutItem } from "@/ui/components/checkout-form";

export const dynamic = "force-dynamic";

const SHIPPING_CENTS = Number.parseInt(process.env.SHIPPING_FLAT_CENTS ?? "590", 10);

export default async function CheckoutPage() {
  const cookieStore = cookies();
  const cartId = cookieStore.get(CART_COOKIE_NAME)?.value;
  const cart = cartId ? await readCart(cartId) : null;
  const items = cart?.items ?? [];
  const totals = computeTotals(items, SHIPPING_CENTS);

  if (items.length === 0) {
    return (
      <div className="page">
        <div className="page__head enter enter-1">
          <div>
            <h1 className="page__title">Validation de commande</h1>
          </div>
        </div>

        <div className="empty-state enter enter-2">
          <span className="empty-state__emoji" aria-hidden>
            🛒
          </span>
          <p className="empty-state__title">Votre panier est vide</p>
          <p className="empty-state__text">
            Il n&apos;y a rien à commander pour l&apos;instant. Ajoutez au moins un article depuis
            le catalogue, puis revenez sur cette page pour saisir vos coordonnées.
          </p>
          <div className="empty-state__actions">
            <Link href="/products" className="btn btn-primary">
              Voir le catalogue
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const checkoutItems: CheckoutItem[] = items.map((i) => ({
    variantId: i.variantId,
    productName: i.variant.product.name,
    variantName: i.variant.name,
    unitPriceCents: i.unitPriceCents,
    quantity: i.quantity,
  }));

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <h1 className="page__title">Validation de commande</h1>
          <p className="page__sub">
            Vos coordonnées, votre adresse de livraison et votre moyen de paiement. Aucun compte
            n&apos;est nécessaire.
          </p>
        </div>
      </div>

      <div className="split enter enter-2">
        <div className="section">
          <CheckoutForm />
        </div>

        <aside className="split__aside">
          <div className="card">
            <h2 className="card__title">Récapitulatif</h2>
            <div className="summary">
              {checkoutItems.map((i) => (
                <div key={i.variantId} className="summary__row">
                  <span className="summary__label">
                    {i.productName} <span className="num">× {i.quantity}</span>
                  </span>
                  <span className="summary__value money">
                    {formatMoneyEur(i.unitPriceCents * i.quantity)}
                  </span>
                </div>
              ))}
              <div className="summary__row">
                <span className="summary__label">Sous-total</span>
                <span className="summary__value money">
                  {formatMoneyEur(totals.subtotalCents)}
                </span>
              </div>
              <div className="summary__row">
                <span className="summary__label">Livraison</span>
                <span className="summary__value money">
                  {formatMoneyEur(totals.shippingCents)}
                </span>
              </div>
              <div className="summary__row summary__row--total">
                <span className="summary__label">Total</span>
                <span className="money">{formatMoneyEur(totals.totalCents)}</span>
              </div>
            </div>
          </div>

          <p className="note">
            Paiement sécurisé (mode démonstration). Aucun débit réel n&apos;est effectué.
          </p>
        </aside>
      </div>
    </div>
  );
}
