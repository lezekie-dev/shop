"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Champ de saisie du code promo — partagé par le panier ET le checkout.
 *
 * ─── POURQUOI UN SEUL CHAMP POUR LES DEUX ÉCRANS ────────────────────────
 * Le code vit sur le CART (`Cart.promoCode`), pas sur la page de commande.
 * Les deux écrans écrivent donc au même endroit, via la même route
 * (`POST /api/cart/promo`) : il ne peut pas y avoir « un code saisi au panier »
 * et « un autre code saisi au checkout » qui se contrediraient au moment de
 * payer.
 *
 * ─── CE QUE CE COMPOSANT N'ENVOIE PAS ───────────────────────────────────
 * Aucun montant. Il envoie le code saisi et n'affiche que ce que le serveur
 * renvoie : la remise est calculée côté serveur, à partir du sous-total lu en
 * base (un montant décidé par le navigateur serait une faille, pas une
 * fonctionnalité — risque R4 du brief).
 *
 * ─── POURQUOI LE REFUS AFFICHE LE MOTIF EXACT ───────────────────────────
 * Le serveur renvoie une phrase actionnable (« il manque 12,50 € », « expiré
 * le 20 septembre »). Le composant l'affiche TELLE QUELLE : réécrire le
 * message ici ferait diverger les deux formulations, et c'est celle du serveur
 * qui est vérifiée par les tests.
 */
export function PromoCodeField({
  appliedCode,
  refusalMessage,
}: {
  /** Code actuellement stocké sur le panier (forme normalisée), `null` sinon. */
  appliedCode: string | null;
  /** Motif du dernier refus, calculé côté serveur au rendu. */
  refusalMessage: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(
    refusalMessage ? { kind: "error", text: refusalMessage } : null,
  );

  async function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entered = code.trim();
    if (entered.length === 0) return;

    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/cart/promo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: entered }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        applied?: boolean;
        promoCode?: string | null;
        message?: string;
        error?: string;
      };

      if (data.applied) {
        setCode("");
        setFeedback({
          kind: "ok",
          text: `Code ${data.promoCode ?? entered} appliqué : la remise est reportée sur le total ci-dessous.`,
        });
      } else {
        // Le motif vient du serveur — jamais un « code invalide » générique :
        // le client doit savoir quoi corriger (AC E2).
        setFeedback({
          kind: "error",
          text: data.message ?? data.error ?? "Ce code n'a pas pu être appliqué.",
        });
      }
      router.refresh();
    } catch {
      setFeedback({ kind: "error", text: "Erreur réseau : le code n'a pas pu être vérifié." });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await fetch("/api/cart/promo", { method: "DELETE" });
      setFeedback(null);
      router.refresh();
    } catch {
      setFeedback({ kind: "error", text: "Erreur réseau : le code n'a pas pu être retiré." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-grid">
      {appliedCode ? (
        <div className="form-field form-field--narrow">
          <span className="form-field__label">Code promo</span>
          <p style={{ margin: 0 }}>
            <strong className="num">{appliedCode}</strong> — remise appliquée au total ci-dessous.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRemove}
            disabled={busy}
          >
            {busy ? "Retrait…" : "Retirer le code"}
          </button>
        </div>
      ) : (
        <form className="form-field form-field--narrow" onSubmit={handleApply}>
          <label className="form-field__label" htmlFor="promo-code">
            Code promo
          </label>
          <input
            id="promo-code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={64}
            autoComplete="off"
            // Les codes sont en majuscules : le clavier mobile passe en
            // capitales, ce qui évite une faute de frappe par code saisi.
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="EX : BIENVENUE"
            disabled={busy}
          />
          <button type="submit" className="btn btn-secondary" disabled={busy || code.trim().length === 0}>
            {busy ? "Vérification…" : "Appliquer"}
          </button>
        </form>
      )}

      {feedback ? (
        <p
          className={
            feedback.kind === "ok"
              ? "form-feedback form-feedback--ok"
              : "form-feedback form-feedback--error"
          }
          role={feedback.kind === "ok" ? "status" : "alert"}
        >
          {feedback.text}
        </p>
      ) : null}

      <p className="form-field__hint">
        Un seul code par commande. La remise peut être retirée à tout moment avant le paiement.
      </p>
    </div>
  );
}
