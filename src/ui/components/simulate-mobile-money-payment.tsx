"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Bouton de DÉMONSTRATION : rejoue le callback que l'agrégateur Mobile Money
 * enverrait à la boutique après validation du paiement par le client (push
 * USSD). En production, ce composant n'existe pas — c'est NotchPay/Flutterwave
 * qui appelle POST /api/payments/mobile-money/callback.
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
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <button
        type="button"
        onClick={() => {
          void confirmFromOperator();
        }}
        disabled={busy}
        style={{
          padding: "0.75rem 1rem",
          background: busy ? "#666" : "#111",
          color: "#fff",
          border: 0,
          borderRadius: 6,
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "Confirmation…" : "J'ai validé le paiement sur mon téléphone"}
      </button>
      <p style={{ margin: 0, color: "#777", fontSize: "0.85rem" }}>
        Démonstration : ce bouton rejoue le callback que l&apos;opérateur enverrait à la
        boutique. Aucun compte Mobile Money réel n&apos;est débité.
      </p>
      {error && (
        <p role="alert" style={{ margin: 0, color: "#b00020" }}>
          {error}
        </p>
      )}
    </div>
  );
}
