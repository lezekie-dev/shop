"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Édition du stock d'une variante (PATCH /api/admin/variants/[id]/stock).
 *
 * `reserved` n'est pas exposé : il est piloté par le checkout, pas par le
 * marchand. On l'affiche en lecture seule dans le tableau pour expliquer la
 * différence entre stock réel et disponible.
 *
 * Après succès, le formulaire est remplacé par une confirmation : impossible de
 * renvoyer la même valeur (idempotence côté UI).
 */

export function VariantStockForm({
  variantId,
  sku,
  quantity,
}: {
  variantId: string;
  sku: string;
  quantity: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get("quantity") ?? "").trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Quantité invalide : entier positif ou zéro attendu.");
      return;
    }
    if (parsed === quantity) {
      setError(null);
      setSaved("Stock inchangé.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/admin/variants/${variantId}/stock`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity: parsed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Échec de la mise à jour (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      setSaved(`Stock de ${sku} : ${parsed} unité(s).`);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau : le stock n'a pas été mis à jour.");
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <span className="badge badge-paid">
        <span aria-hidden>✓</span>
        {saved}
      </span>
    );
  }

  return (
    <form onSubmit={onSubmit} className="admin-inline">
      <label className="sr-only" htmlFor={`stock-${variantId}`}>
        Stock réel de {sku}
      </label>
      <input
        id={`stock-${variantId}`}
        type="number"
        name="quantity"
        min={0}
        step={1}
        defaultValue={quantity}
        required
        style={{ width: "6.5rem" }}
      />
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        {busy ? "…" : "Mettre à jour"}
      </button>
      {error ? (
        <span className="form-feedback form-feedback--error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
