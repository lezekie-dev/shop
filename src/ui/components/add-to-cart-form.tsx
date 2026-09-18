"use client";

import { useState, type FormEvent } from "react";

import { formatMoneyEur } from "@/domain/pricing";

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

  const soldOut = maxQty <= 0;
  const selectedSoldOut = selected !== undefined && selected.available <= 0;

  return (
    <form onSubmit={handleSubmit} className="form-grid">
      <label className={selectedSoldOut ? "form-field form-field--invalid" : "form-field"}>
        <span className="form-field__label">
          Variante <span className="form-field__req">*</span>
        </span>
        <select
          name="variantId"
          required
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          disabled={submitting}
        >
          {variants.map((v) => (
            <option key={v.id} value={v.id} disabled={v.available <= 0}>
              {v.name} — {formatMoneyEur(v.priceCents)}
              {v.available <= 0 ? " (rupture)" : ""}
            </option>
          ))}
        </select>
        {selectedSoldOut ? (
          <p className="form-field__error">
            Cette variante est en rupture de stock : choisissez-en une autre dans la liste.
          </p>
        ) : (
          <p className="form-field__hint">
            Les variantes en rupture restent visibles mais ne sont pas sélectionnables.
          </p>
        )}
      </label>

      <label className="form-field form-field--narrow">
        <span className="form-field__label">Quantité</span>
        <input
          type="number"
          name="quantity"
          min={1}
          max={Math.max(1, maxQty)}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
          required
          disabled={submitting || soldOut}
        />
        {maxQty > 0 && maxQty < 10 && (
          <p className="form-field__hint">
            Stock disponible : <span className="num">{maxQty}</span>
          </p>
        )}
      </label>

      {error && (
        <p role="alert" className="form-feedback form-feedback--error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="form-feedback form-feedback--ok">
          {success}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting || soldOut}>
          {soldOut ? "Rupture de stock" : submitting ? "Ajout…" : "Ajouter au panier"}
        </button>
        {selected && !soldOut && (
          <span className="muted small">
            Total : <span className="money">{formatMoneyEur(selected.priceCents * quantity)}</span>
          </span>
        )}
      </div>
    </form>
  );
}
