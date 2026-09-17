import { cookies } from "next/headers";
import Link from "next/link";

import { CART_COOKIE_NAME, readCart } from "@/server/cart";
import { computeTotals } from "@/domain/cart";
import { prisma } from "@/lib/db";
import { CartItemsClient } from "@/ui/components/cart-items-client";

export const dynamic = "force-dynamic";

const SHIPPING_CENTS = Number.parseInt(process.env.SHIPPING_FLAT_CENTS ?? "590", 10);

export default async function CartPage() {
  const cookieStore = cookies();
  const cartId = cookieStore.get(CART_COOKIE_NAME)?.value;
  const cart = cartId ? await readCart(cartId) : null;
  const totals = computeTotals(cart?.items ?? [], SHIPPING_CENTS);
  const hasItems = (cart?.items.length ?? 0) > 0;

  // Précharge les Variants/Products pour les rows
  const variantIds = (cart?.items ?? []).map((i) => i.variantId);
  const variants =
    variantIds.length === 0
      ? []
      : await prisma.variant.findMany({
          where: { id: { in: variantIds } },
          include: { product: { select: { name: true, slug: true } } },
        });
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  if (!hasItems) {
    return (
      <section style={{ padding: "2rem 0" }}>
        <h1>Votre panier</h1>
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

  const itemsForClient = (cart?.items ?? [])
    .map((i) => {
      const v = variantMap.get(i.variantId);
      if (!v) return null;
      return {
        variantId: i.variantId,
        productName: v.product.name,
        variantName: v.name,
        productSlug: v.product.slug,
        unitPriceCents: i.unitPriceCents,
        quantity: i.quantity,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <section style={{ padding: "1rem 0" }}>
      <h1>Votre panier</h1>
      <CartItemsClient items={itemsForClient} />

      <div
        style={{
          marginTop: "1.5rem",
          padding: "1rem",
          border: "1px solid #e5e5e5",
          borderRadius: 8,
          background: "#fff",
          display: "grid",
          gap: "0.5rem",
        }}
      >
        <Row label="Sous-total" cents={totals.subtotalCents} />
        <Row label="Livraison" cents={totals.shippingCents} />
        <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "0.25rem 0" }} />
        <Row label="Total" cents={totals.totalCents} bold />
      </div>

      <p style={{ marginTop: "1.5rem" }}>
        <Link
          href="/checkout"
          style={{
            display: "inline-block",
            padding: "0.75rem 1.25rem",
            background: "#111",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Passer commande
        </Link>
      </p>
    </section>
  );
}

function Row({ label, cents, bold }: { label: string; cents: number; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: bold ? "#111" : "#666", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>
        {(cents / 100).toFixed(2).replace(".", ",")} €
      </span>
    </div>
  );
}
