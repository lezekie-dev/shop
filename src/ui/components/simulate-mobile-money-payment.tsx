"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Bouton de DÉMONSTRATION : rejoue le callback que l'agrégateur Mobile Money
 * enverrait à la boutique après validation du paiement par le client (push
 * USSD). En production, ce composant n'existe pas — c'est NotchPay/Flutterwave
 * qui appelle POST /api/payments/mobile-money/callback.
 *
 * Le bloc est explicitement étiqueté « Démonstration » (badge + texte) pour
 * qu'aucun utilisateur ne le prenne pour un vrai bouton de paiement.
 */
export function SimulateMobileMoneyPayment({
  providerRef,
  orderId,
}: {
  providerRef: string;
  orderId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmFromOperator(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/mobile-money/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mock-signature": `t=${Date.now()},v1=simulated`,
        },
        body: JSON.stringify({
          providerRef,
          eventKey: `sim_${providerRef}_${Date.now()}`,
          type: "payment.succeeded",
          status: "succeeded",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      router.push(`/orders/${orderId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la confirmation");
      setBusy(false);
    }
  }

  return (
    <div className="card form-grid">
      <div className="actions actions--between">
        <span className="badge badge-neutral">Démonstration</span>
        <span className="note">Aucun compte Mobile Money réel n&apos;est débité.</span>
      </div>

      <p className="note">
        Ce bouton rejoue la notification que l&apos;opérateur enverrait à la boutique après votre
        validation. Il n&apos;existe pas en production.
      </p>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => {
            void confirmFromOperator();
          }}
        >
          {busy ? "Confirmation…" : "J'ai validé le paiement sur mon téléphone"}
        </button>
      </div>

      {error && (
        <p role="alert" className="form-feedback form-feedback--error">
          {error}
        </p>
      )}
    </div>
  );
}
