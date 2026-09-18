"use client";

import { useState, type FormEvent } from "react";

import { formatMoneyEur } from "@/domain/pricing";

export type AddToCartFormProps = {
  variants: Array<{
    id: string;
    name: string;
    priceCents: number;
    available: number;
    color?: string | null;
  }>;
  /** Variante présélectionnée, déduite du visuel affiché quand c'est possible. */
  defaultVariantId?: string | null;
};

/**
 * Teintes des variantes, indexées par nom de couleur français.
 *
 * Les couleurs sont du CONTENU (elles viennent des attributs produits), mais
 * leur rendu visuel doit vivre dans l'interface : on ne stocke pas un code
 * hexadécimal en base pour une pastille d'affichage. La table est donc ici,
 * et une couleur inconnue retombe simplement sur l'absence de pastille —
 * jamais sur une couleur inventée, qui mentirait sur le produit.
 */
const COLOR_HEX: Record<string, string> = {
  noir: "#2a1810",
  blanc: "#fdfcfa",
  beige: "#d9c7a8",
  naturel: "#e8dcc4",
  kaki: "#7a7455",
  creme: "#f3e7d3",
  crème: "#f3e7d3",
  gris: "#9a9a9a",
  bleu: "#3b5b8c",
  marine: "#1f2f4d",
  rouge: "#b03a2e",
  vert: "#4a6b3f",
  ocre: "#c2833b",
  terracotta: "#c2410c",
};

/**
 * Form d'ajout au panier, branché sur /api/cart (POST JSON).
 *
 * Trois choix d'interface, dictés par l'usage réel :
 *
 *  1. La variante présélectionnée est celle que MONTRE le visuel. Sans cela le
 *     client voyait une casquette noire et un formulaire sur « Beige ».
 *  2. La quantité se règle par boutons −/+ et non par un champ libre : sur
 *     mobile, taper dans un champ numérique ouvre le clavier et oblige à
 *     viser, alors que deux boutons de 44 px se touchent sans réfléchir.
 *  3. La rupture de stock est annoncée en clair (« Plus disponible »), pas par
 *     une note technique sur le comportement du menu déroulant.
 *
 * Les options indisponibles restent affichées mais désactivées : les masquer
 * donnerait l'impression d'un catalogue incomplet.
 */
export function AddToCartForm({ variants, defaultVariantId }: AddToCartFormProps) {
  const preferred =
    defaultVariantId && variants.some((v) => v.id === defaultVariantId) ? defaultVariantId : null;
  const firstAvailable = variants.find((v) => v.available > 0);
  const [variantId, setVariantId] = useState(
    preferred ?? firstAvailable?.id ?? variants[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = variants.find((v) => v.id === variantId);
  const maxQty = selected?.available ?? 0;
  const soldOut = maxQty <= 0;
  const selectedSoldOut = selected !== undefined && selected.available <= 0;

  // Pastilles : uniquement les variantes dont la couleur est reconnue. Une
  // couleur inconnue est ignorée plutôt que rendue en gris — une pastille
  // grise pour un article « rouille » serait un mensonge visuel.
  const colorVariants = variants
    .map((v) => {
      const key = v.color?.toLowerCase().trim();
      const hex = key ? COLOR_HEX[key] : undefined;
      return hex ? { id: v.id, name: v.name, hex, soldOut: v.available <= 0 } : null;
    })
    .filter((v): v is { id: string; name: string; hex: string; soldOut: boolean } => v !== null);

  // Les pastilles ne remplacent le menu déroulant que si elles couvrent TOUTES
  // les variantes ET qu'il y en a plusieurs. Sinon (une seule couleur, ou des
  // variantes de taille sans couleur reconnue) on garde le menu, qui sait tout
  // afficher — un contrôle partiel ferait disparaître des choix.
  const useSwatches = colorVariants.length > 1 && colorVariants.length === variants.length;

  // Le stock plafonne la quantité : on ne laisse pas commander 10 exemplaires
  // d'un article qui n'en a que 2.
  function setQty(next: number) {
    const cap = Math.max(1, maxQty);
    setQuantity(Math.min(cap, Math.max(1, next)));
  }

  // Changer de variante remet la quantité à 1 : elle a été plafonnée sur
  // l'ancien stock, la conserver donnerait un total faux.
  function selectVariant(id: string) {
    setVariantId(id);
    setQuantity(1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!variantId) {
      setError("Choisissez une variante avant d'ajouter au panier.");
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
    <form onSubmit={handleSubmit} className="form-grid">
      <div className={selectedSoldOut ? "form-field form-field--invalid" : "form-field"}>
        {/* Deux contrôles pour une même valeur, c'est ambigu : le client se
            demande s'il règle deux choses différentes. Quand TOUTES les
            variantes ont une couleur reconnue, les pastilles suffisent et le
            menu déroulant disparaît ; sinon (tailles, finitions, couleurs
            inconnues) on garde le menu, seul contrôle capable de tout afficher. */}
        {useSwatches ? (
          <>
            <span className="form-field__label" id="color-label">
              Couleur
            </span>
            <div className="variant-swatches" role="radiogroup" aria-labelledby="color-label">
              {colorVariants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={v.id === variantId}
                  className={
                    v.id === variantId
                      ? "variant-swatches__item variant-swatches__item--active"
                      : "variant-swatches__item"
                  }
                  onClick={() => !v.soldOut && selectVariant(v.id)}
                  disabled={v.soldOut || submitting}
                  title={v.soldOut ? `${v.name} — épuisé` : v.name}
                >
                  <span
                    className="variant-swatch"
                    style={{ background: v.hex }}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
            {/* Le nom de la couleur retenue reste écrit en clair : une pastille
                seule oblige à deviner la teinte, ce qui exclut les daltoniens. */}
            <p className="form-field__hint">
              Couleur choisie : <strong>{selected?.name}</strong>
            </p>
          </>
        ) : (
          <>
            <label className="form-field__label" htmlFor="variant-select">
              Variante <span className="form-field__req">*</span>
            </label>
            <select
              id="variant-select"
              name="variantId"
              required
              value={variantId}
              onChange={(e) => selectVariant(e.target.value)}
              disabled={submitting}
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id} disabled={v.available <= 0}>
                  {v.name} — {formatMoneyEur(v.priceCents)}
                  {v.available <= 0 ? " (épuisé)" : ""}
                </option>
              ))}
            </select>
          </>
        )}
        {selectedSoldOut && (
          <p className="form-field__error">
            Cette variante est épuisée. Choisissez-en une autre pour continuer.
          </p>
        )}
      </div>

      <div className="form-field form-field--narrow">
        <span className="form-field__label" id="qty-label">
          Quantité
        </span>
        <div className="qty-stepper" role="group" aria-labelledby="qty-label">
          <button
            type="button"
            className="qty-stepper__btn"
            onClick={() => setQty(quantity - 1)}
            disabled={submitting || soldOut || quantity <= 1}
            aria-label="Diminuer la quantité"
          >
            −
          </button>
          <span className="qty-stepper__value num" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            className="qty-stepper__btn"
            onClick={() => setQty(quantity + 1)}
            disabled={submitting || soldOut || quantity >= maxQty}
            aria-label="Augmenter la quantité"
          >
            +
          </button>
        </div>
        {/* Le stock n'est annoncé que s'il est BAS : c'est là qu'il devient un
            argument (« il n'en reste que 3 »). Affiché systématiquement, il
            attire l'attention sur une logistique sans intérêt pour l'achat. */}
        {maxQty > 0 && maxQty <= 10 && (
          <p className="form-field__hint">
            Il ne reste que <span className="num">{maxQty}</span> en stock
          </p>
        )}
      </div>

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
        <button type="submit" className="btn btn-primary btn--lg" disabled={submitting || soldOut}>
          {soldOut ? "Épuisé" : submitting ? "Ajout…" : "Ajouter au panier"}
        </button>
        {selected && !soldOut && (
          <span className="purchase-total">
            Total <span className="money">{formatMoneyEur(selected.priceCents * quantity)}</span>
          </span>
        )}
      </div>
    </form>
  );
}
