import { cookies } from "next/headers";
import Link from "next/link";

import { CART_COOKIE_NAME, readCart } from "@/server/cart";
import { computeTotals } from "@/domain/cart";
import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { CartItemsClient } from "@/ui/components/cart-items-client";
import {
  IconCart,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

const SHIPPING_CENTS = Number.parseInt(process.env.SHIPPING_FLAT_CENTS ?? "590", 10);

export default async function CartPage() {
  const cookieStore = cookies();
  const cartId = cookieStore.get(CART_COOKIE_NAME)?.value;
  const cart = cartId ? await readCart(cartId) : null;
  const totals = computeTotals(cart?.items ?? [], SHIPPING_CENTS);
  const hasItems = (cart?.items.length ?? 0) > 0;

  if (!hasItems) {
    return (
      <div className="page">
        <div className="page__head enter enter-1">
          <div>
            <h1 className="page__title">Votre panier</h1>
          </div>
        </div>

        <div className="empty-state enter enter-2">
          <IconCart className="empty-state__icon" />
          <p className="empty-state__title">Votre panier est vide</p>
          <p className="empty-state__text">
            Aucun article n&apos;a encore été ajouté. Parcourez le catalogue, choisissez une
            variante puis cliquez sur « Ajouter au panier » : votre sélection apparaîtra ici.
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

  // Précharge les Variants/Products (et leur stock) pour les rows
  const variantIds = (cart?.items ?? []).map((i) => i.variantId);
  const variants =
    variantIds.length === 0
      ? []
      : await prisma.variant.findMany({
          where: { id: { in: variantIds } },
          include: { product: { select: { name: true, slug: true } }, stock: true },
        });
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const itemsForClient = (cart?.items ?? [])
    .map((i) => {
      const v = variantMap.get(i.variantId);
      if (!v) return null;
      const reserved = v.stock?.reserved ?? 0;
      const quantity = v.stock?.quantity ?? 0;
      return {
        variantId: i.variantId,
        productName: v.product.name,
        variantName: v.name,
        productSlug: v.product.slug,
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
        available: Math.max(0, quantity - reserved),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <h1 className="page__title">Votre panier</h1>
          <p className="page__sub">
            <span className="num">{itemsForClient.length}</span> article
            {itemsForClient.length > 1 ? "s" : ""} — vous pouvez modifier les quantités avant de
            commander.
          </p>
        </div>
      </div>

      <div className="split enter enter-2">
        <div className="section">
          <CartItemsClient items={itemsForClient} />
        </div>

        <aside className="split__aside">
          <div className="card">
            <h2 className="card__title">Récapitulatif</h2>
            <div className="summary">
              <div className="summary__row">
                <span className="summary__label">Sous-total</span>
                <span className="summary__value money">{formatMoneyEur(totals.subtotalCents)}</span>
              </div>
              <div className="summary__row">
                <span className="summary__label">Livraison</span>
                <span className="summary__value money">{formatMoneyEur(totals.shippingCents)}</span>
              </div>
              <div className="summary__row summary__row--total">
                <span className="summary__label">Total</span>
                <span className="money">{formatMoneyEur(totals.totalCents)}</span>
              </div>
            </div>
          </div>

          <div className="section">
            <Link href="/checkout" className="btn btn-primary btn-block">
              Passer commande
            </Link>
            <p className="note">
              Livraison en France métropolitaine. Aucun compte n&apos;est nécessaire.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
