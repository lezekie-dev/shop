"use client";

import { useRouter } from "next/navigation";

import { CartItemRow, type CartItemRowProps } from "@/ui/components/cart-item-row";

export type CartItemForRow = Omit<CartItemRowProps, "onUpdate" | "onRemove">;

async function patchCart(variantId: string, quantity: number): Promise<void> {
  const res = await fetch("/api/cart", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ variantId, quantity }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Erreur ${res.status}`);
  }
}

async function deleteCartItem(variantId: string): Promise<void> {
  const res = await fetch("/api/cart", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ variantId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Erreur ${res.status}`);
  }
}

/**
 * Liste des articles du panier. Client : interagit avec /api/cart
 * (PATCH / DELETE) puis force un refresh du server component parent.
 */
export function CartItemsClient({ items }: { items: CartItemForRow[] }) {
  const router = useRouter();

  if (items.length === 0) {
    return (
      <p style={{ color: "#666", marginTop: "0.5rem" }}>Votre panier est vide.</p>
    );
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0", display: "grid", gap: "0.5rem" }}>
      {items.map((it) => (
        <CartItemRow
          key={it.variantId}
          {...it}
          onUpdate={async (variantId, quantity) => {
            await patchCart(variantId, quantity);
            router.refresh();
          }}
          onRemove={async (variantId) => {
            await deleteCartItem(variantId);
            router.refresh();
          }}
        />
      ))}
    </ul>
  );
}
