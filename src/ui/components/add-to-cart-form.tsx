"use client";

import { useState, type FormEvent } from "react";

import { Money } from "@/ui/components/money";

export type AddToCartFormProps = {
  variants: Array<{
    id: string;
    name: string;
    priceCents: number;
    available: number;
  }>;
};

/**
 * Form d'ajout au panier, branché sur /api/cart (POST JSON).
 * Gère les ruptures de stock côté UI : option disabled pour stock = 0.
 * Redirige vers /cart après succès (ou affiche un message).
 */
export function AddToCartForm({ variants }: AddToCartFormProps) {
  const firstAvailable = variants.find((v) => v.available > 0);
  const [variantId, setVariantId] = useState(firstAvailable?.id ?? variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = variants.find((v) => v.id === variantId);
  const maxQty = selected?.available ?? 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!variantId) {
      setError("Veuillez sélectionner une variante.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, quantity }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        items?: unknown[];
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      const count = Array.isArray(data.items) ? data.items.length : 0;
      setSuccess(`Ajouté au panier (${count} article${count > 1 ? "s" : ""}).`);
      // Redirige après 600ms pour donner le temps de lire le toast
      setTimeout(() => {
        window.location.href = "/cart";
      }, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'ajout");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: "2rem", display: "grid", gap: "1rem" }}>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Variante</span>
        <select
          name="variantId"
          required
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          disabled={submitting}
          style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id} disabled={v.available <= 0}>
              {v.name} — {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v.priceCents / 100)}
              {v.available <= 0 ? " (rupture)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: "0.25rem", maxWidth: 160 }}>
        <span>Quantité</span>
        <input
          type="number"
          name="quantity"
          min={1}
          max={Math.max(1, maxQty)}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
          required
          disabled={submitting || maxQty <= 0}
          style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
        />
        {maxQty > 0 && maxQty < 10 && (
          <span style={{ color: "#777", fontSize: "0.8rem" }}>Stock : {maxQty}</span>
        )}
      </label>

      {error && (
        <p role="alert" style={{ color: "#b00020", margin: 0, fontSize: "0.9rem" }}>
          {error}
        </p>
      )}
      {success && (
        <p role="status" style={{ color: "#1e7a36", margin: 0, fontSize: "0.9rem" }}>
          {success}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="submit"
          disabled={submitting || maxQty <= 0}
          style={{
            padding: "0.75rem 1rem",
            background: maxQty <= 0 ? "#999" : "#111",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            cursor: maxQty <= 0 ? "not-allowed" : submitting ? "wait" : "pointer",
            width: "fit-content",
          }}
        >
          {maxQty <= 0 ? "Rupture de stock" : submitting ? "Ajout…" : "Ajouter au panier"}
        </button>
        {selected && maxQty > 0 && (
          <span style={{ color: "#666", fontSize: "0.9rem" }}>
            <Money cents={selected.priceCents * quantity} />
          </span>
        )}
      </div>
    </form>
  );
}
