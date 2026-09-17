"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { Money } from "@/ui/components/money";

export type CartItemRowProps = {
  variantId: string;
  productName: string;
  variantName: string;
  productSlug: string;
  unitPriceCents: number;
  quantity: number;
  onUpdate: (variantId: string, quantity: number) => Promise<void>;
  onRemove: (variantId: string) => Promise<void>;
};

/**
 * Ligne d'article dans le panier. Client component : + / − qty, suppression.
 * L'image est un placeholder gris (S2) — S3 branchera ProductImage.
 */
export function CartItemRow(props: CartItemRowProps) {
  const [qty, setQty] = useState(props.quantity);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lineTotal = qty * props.unitPriceCents;

  function commitQty(next: number) {
    setError(null);
    if (!Number.isInteger(next) || next <= 0) {
      setError("Quantité invalide");
      return;
    }
    startTransition(async () => {
      try {
        await props.onUpdate(props.variantId, next);
        setQty(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de mise à jour");
      }
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      try {
        await props.onRemove(props.variantId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur de suppression");
      }
    });
  }

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "72px 1fr auto",
        gap: "0.75rem",
        alignItems: "center",
        padding: "0.75rem",
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        background: "#fff",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 72,
          height: 72,
          background: "#f0f0f0",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#bbb",
          fontSize: "0.75rem",
        }}
      >
        image
      </div>
      <div style={{ minWidth: 0 }}>
        <Link
          href={`/products/${props.productSlug}`}
          style={{ color: "#111", textDecoration: "none", fontWeight: 600 }}
        >
          {props.productName}
        </Link>
        <p style={{ margin: "0.125rem 0 0", color: "#666", fontSize: "0.85rem" }}>
          {props.variantName}
        </p>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>
          <Money cents={props.unitPriceCents} />
        </p>
        {error && (
          <p role="alert" style={{ margin: "0.25rem 0 0", color: "#b00020", fontSize: "0.8rem" }}>
            {error}
          </p>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            border: "1px solid #ccc",
            borderRadius: 6,
          }}
        >
          <button
            type="button"
            aria-label="Diminuer la quantité"
            disabled={pending || qty <= 1}
            onClick={() => commitQty(qty - 1)}
            style={{
              padding: "0.25rem 0.5rem",
              border: 0,
              background: "transparent",
              cursor: qty <= 1 ? "not-allowed" : "pointer",
              opacity: qty <= 1 ? 0.4 : 1,
            }}
          >
            −
          </button>
          <span style={{ minWidth: 28, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
            {qty}
          </span>
          <button
            type="button"
            aria-label="Augmenter la quantité"
            disabled={pending}
            onClick={() => commitQty(qty + 1)}
            style={{
              padding: "0.25rem 0.5rem",
              border: 0,
              background: "transparent",
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
        <div style={{ minWidth: 80, textAlign: "right", fontWeight: 600 }}>
          <Money cents={lineTotal} />
        </div>
        <button
          type="button"
          aria-label="Supprimer l'article"
          disabled={pending}
          onClick={handleRemove}
          style={{
            padding: "0.25rem 0.5rem",
            background: "transparent",
            border: "1px solid #ccc",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          ✕
        </button>
      </div>
    </li>
  );
}
