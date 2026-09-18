"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Formulaire d'édition d'un produit (PATCH /api/admin/products/[id]).
 *
 * Après succès, le formulaire passe en mode confirmé et ne peut plus être
 * resoumis tel quel : l'action est idempotente côté UI, et l'utilisateur voit
 * exactement ce qui a été enregistré.
 */

export type ProductFormValues = {
  id: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  active: boolean;
};

export function ProductForm({
  product,
  categories,
}: {
  product: ProductFormValues;
  categories: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      name: String(form.get("name") ?? "").trim(),
      slug: String(form.get("slug") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      categoryId: String(form.get("categoryId") ?? ""),
      active: form.get("active") === "on",
    };

    const changed = Object.entries(payload).filter(([key, value]) => {
      const current = product[key as keyof ProductFormValues];
      return current !== value;
    });
    if (changed.length === 0) {
      setError(null);
      setSaved("Aucune modification à enregistrer.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Échec de l'enregistrement (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      setSaved("Produit enregistré.");
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau : le produit n'a pas été enregistré.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Nom</span>
          <input type="text" name="name" defaultValue={product.name} required maxLength={160} />
        </label>
        <label className="form-field">
          <span className="form-field__label">Slug (URL)</span>
          <input
            type="text"
            name="slug"
            defaultValue={product.slug}
            required
            maxLength={160}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Minuscules, chiffres et tirets uniquement"
          />
          <span className="form-field__hint">Minuscules, chiffres et tirets.</span>
        </label>
      </div>

      <label className="form-field">
        <span className="form-field__label">Catégorie</span>
        <select name="categoryId" defaultValue={product.categoryId} required>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span className="form-field__label">Description</span>
        <textarea name="description" defaultValue={product.description} rows={6} required />
      </label>

      <label className="form-field">
        <span className="form-field__label">Visibilité</span>
        <span className="admin-inline">
          <input type="checkbox" name="active" defaultChecked={product.active} />
          <span className="form-field__hint">
            Visible dans le catalogue. Décocher masque le produit sans supprimer son historique
            de commandes.
          </span>
        </span>
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer le produit"}
        </button>
      </div>

      {saved ? (
        <p className="form-feedback form-feedback--ok" role="status">
          {saved}
        </p>
      ) : null}
      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
