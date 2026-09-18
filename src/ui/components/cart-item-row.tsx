"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { formatMoneyEur } from "@/domain/pricing";

export type CartItemRowProps = {
  variantId: string;
  productName: string;
  variantName: string;
  productSlug: string;
  unitPriceCents: number;
  quantity: number;
  /** Stock réellement disponible (quantité − réservations) au chargement. */
  available: number;
  onUpdate: (variantId: string, quantity: number) => Promise<void>;
  onRemove: (variantId: string) => Promise<void>;
};

/**
 * Ligne d'article dans le panier. Client component : + / − qty, suppression.
 *
 * Le stock disponible est affiché en clair : si la quantité demandée dépasse le
 * stock, la ligne est signalée (badge + explication) et le bouton « + » est
 * désactivé — le serveur refuserait de toute façon la mise à jour.
 */
export function CartItemRow(props: CartItemRowProps) {
  const [qty, setQty] = useState(props.quantity);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lineTotal = qty * props.unitPriceCents;
  const shortOnStock = props.available < qty;
  const atMaxStock = qty >= props.available;

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
    <li className={shortOnStock ? "card line line--unavailable" : "card line"}>
      <div className="line__media" aria-hidden>
        📦
      </div>

      <div className="line__body">
        <Link href={`/products/${props.productSlug}`} className="line__article">
          {props.productName}
        </Link>
        <p className="line__meta">{props.variantName}</p>
        <p className="line__meta">
          Prix unitaire :{" "}
          <span className="money">{formatMoneyEur(props.unitPriceCents)}</span>
        </p>

        {shortOnStock && (
          <p className="line__meta">
            <span className="badge badge-cancelled">Stock insuffisant</span>{" "}
            {props.available > 0 ? (
              <>
                Il ne reste que <span className="num">{props.available}</span> exemplaire
                {props.available > 1 ? "s" : ""} : réduisez la quantité ou supprimez la ligne.
              </>
            ) : (
              <>Cette variante est en rupture de stock : supprimez la ligne pour continuer.</>
            )}
          </p>
        )}

        {error && (
          <p role="alert" className="form-feedback form-feedback--error">
            {error}
          </p>
        )}

        <div className="line__foot">
          <div className="qty">
            <button
              type="button"
              className="qty__btn"
              aria-label="Diminuer la quantité"
              disabled={pending || qty <= 1}
              onClick={() => commitQty(qty - 1)}
            >
              −
            </button>
            <span className="qty__value">{qty}</span>
            <button
              type="button"
              className="qty__btn"
              aria-label="Augmenter la quantité"
              disabled={pending || atMaxStock}
              onClick={() => commitQty(qty + 1)}
            >
              +
            </button>
          </div>

          <span className="line__total money">{formatMoneyEur(lineTotal)}</span>

          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Supprimer l'article"
            disabled={pending}
            onClick={handleRemove}
          >
            Supprimer
          </button>
        </div>
      </div>
    </li>
  );
}
