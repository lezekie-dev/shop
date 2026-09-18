"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@prisma/client";

import { canMarkPaid } from "@/domain/order-actions";
import { verdictLabel, type ReconcileVerdict } from "@/domain/payment/reconciliation";

/**
 * Actions manuelles sur un paiement en attente.
 *
 * DEUX ACTIONS, DEUX NIVEAUX DE RESPONSABILITÉ (CONVENTIONS §13) :
 *   - « Vérifier maintenant » réinterroge le fournisseur : c'est exactement ce
 *     que la tâche planifiée fait seule, donc ouvert à qui voit la page ;
 *   - « Marquer payé » DÉCIDE d'un encaissement (virement reçu en banque) :
 *     réservé à la capacité `orders:transition:paid`, donc ADMIN.
 *
 * Le bouton affiché est exactement celui que l'API acceptera : les deux gardes
 * viennent du même module (`@/domain/order-actions` + la matrice de capacités),
 * donc il n'existe pas de bouton qui renvoie 403 ou 409.
 */

type ApiResult = {
  error?: string;
  message?: string;
  verdict?: ReconcileVerdict;
  paymentStatus?: string;
  orderStatus?: string;
  status?: string;
  idempotent?: boolean;
  code?: string;
};

export function PaymentActions({
  paymentId,
  orderId,
  orderNumber,
  orderStatus,
  provider,
  canConfirmReceipt,
}: {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  provider: string;
  /** Capacité `orders:transition:paid` de l'utilisateur courant. */
  canConfirmReceipt: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ label: string; message: string } | null>(null);

  // Le bouton « Marquer payé » suit les mêmes conditions que la route
  // `mark-paid` : virement bancaire + commande en attente de paiement.
  const showMarkPaid =
    canConfirmReceipt && canMarkPaid({ status: orderStatus, paymentProvider: provider });

  async function post(url: string, body?: Record<string, string>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        ...(body
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResult;
      if (!res.ok) {
        setError(data.error ?? `Échec de l'action (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      setOutcome({
        label: data.verdict ? verdictLabel(data.verdict) : "Enregistré",
        message: data.message ?? `Paiement de la commande ${orderNumber} confirmé.`,
      });
      setBusy(false);
      // La liste et les compteurs de la page dépendent de l'état en base :
      // rafraîchir le Server Component évite d'afficher une ligne périmée.
      router.refresh();
    } catch {
      setError("Erreur réseau : l'action n'a pas pu être envoyée.");
      setBusy(false);
    }
  }

  function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void post(`/api/admin/payments/${paymentId}/reconcile`);
  }

  function onMarkPaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Confirmation explicite : confirmer un encaissement engage de l'argent
    // réel et décrémente le stock réservé. Un clic accidentel ne se rattrape pas.
    const ok = window.confirm(
      `Confirmer la réception du virement de la commande ${orderNumber} ?\n\n` +
        "La commande passera en « Payée », le stock réservé sera décrémenté et " +
        "l'email de confirmation sera envoyé au client.",
    );
    if (!ok) return;
    void post(`/api/admin/orders/${orderId}/mark-paid`);
  }

  if (outcome) {
    return (
      <div className="notice" role="status">
        <p className="notice__title">{outcome.label}</p>
        <p style={{ margin: 0 }}>{outcome.message}</p>
      </div>
    );
  }

  return (
    <div className="admin-stack">
      <form onSubmit={onVerify} style={{ display: "inline" }}>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? "Vérification…" : "Vérifier maintenant"}
        </button>
      </form>

      {showMarkPaid ? (
        <form onSubmit={onMarkPaid} style={{ display: "inline" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Enregistrement…" : "Marquer payé"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
