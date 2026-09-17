import { cookies } from "next/headers";
import Link from "next/link";

import { CART_COOKIE_NAME, readCart } from "@/server/cart";
import { computeTotals } from "@/domain/cart";
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
      <section style={{ padding: "2rem 0" }}>
        <h1>Validation de commande</h1>
        <p style={{ color: "#666", marginTop: "0.5rem" }}>Votre panier est vide.</p>
        <p style={{ marginTop: "1.5rem" }}>
          <Link
            href="/products"
            style={{
              display: "inline-block",
              padding: "0.6rem 1rem",
              background: "#111",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            Voir le catalogue
          </Link>
        </p>
      </section>
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
    <section
      style={{
        padding: "1rem 0",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: "1.5rem",
        alignItems: "start",
      }}
    >
      <div>
        <h1 style={{ marginBottom: "1rem" }}>Validation de commande</h1>
        <CheckoutForm />
      </div>
      <aside
        style={{
          padding: "1rem",
          border: "1px solid #e5e5e5",
          borderRadius: 8,
          background: "#fff",
          position: "sticky",
          top: "1rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Récapitulatif</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0", display: "grid", gap: "0.5rem" }}>
          {checkoutItems.map((i) => (
            <li
              key={i.variantId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "0.5rem",
                fontSize: "0.9rem",
              }}
            >
              <span>
                {i.productName} <span style={{ color: "#777" }}>× {i.quantity}</span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {((i.unitPriceCents * i.quantity) / 100).toFixed(2).replace(".", ",")} €
              </span>
            </li>
          ))}
        </ul>
        <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "0.5rem 0" }} />
        <Row label="Sous-total" cents={totals.subtotalCents} />
        <Row label="Livraison" cents={totals.shippingCents} />
        <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "0.5rem 0" }} />
        <Row label="Total" cents={totals.totalCents} bold />
        <p style={{ margin: "0.75rem 0 0", color: "#777", fontSize: "0.8rem" }}>
          Paiement sécurisé (mock). Aucun débit réel.
        </p>
      </aside>
    </section>
  );
}

function Row({ label, cents, bold }: { label: string; cents: number; bold?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        fontSize: bold ? "1rem" : "0.9rem",
        margin: "0.15rem 0",
      }}
    >
      <span style={{ color: bold ? "#111" : "#666", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>
        {(cents / 100).toFixed(2).replace(".", ",")} €
      </span>
    </div>
  );
}
