"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { canMarkPaid, canMarkShipped } from "@/domain/order-actions";
import type { OrderStatus } from "@prisma/client";

/**
 * Actions de traitement d'une commande.
 *
 * Les boutons affichés sont exactement ceux que l'API acceptera (mêmes gardes
 * que les routes, cf. `@/domain/order-actions`) : pas de bouton qui renvoie 409.
 *
 * Idempotence côté UI : dès qu'une action réussit, le formulaire est remplacé
 * par une confirmation et ne peut plus être resoumis. Un double clic pendant la
 * requête est neutralisé par `busy`.
 */

type ApiResult = {
  error?: string;
  message?: string;
  status?: string;
  carrier?: string;
  trackingNo?: string;
  idempotent?: boolean;
};

export function OrderActions({
  orderId,
  number,
  status,
  paymentProvider,
}: {
  orderId: string;
  number: string;
  status: OrderStatus;
  paymentProvider: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const showMarkPaid = canMarkPaid({ status, paymentProvider });
  const showMarkShipped = canMarkShipped({ status });

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
      setDone(
        data.message ??
          (data.status === "SHIPPED"
            ? `Commande ${number} marquée expédiée${data.trackingNo ? ` (suivi ${data.trackingNo})` : ""}.`
            : `Commande ${number} marquée payée.`),
      );
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau : l'action n'a pas pu être envoyée.");
      setBusy(false);
    }
  }

  function onMarkPaid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void post(`/api/admin/orders/${orderId}/mark-paid`);
  }

  function onMarkShipped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const carrier = String(form.get("carrier") ?? "").trim();
    const trackingNo = String(form.get("trackingNo") ?? "").trim();
    if (!carrier) {
      setError("Le transporteur est obligatoire.");
      return;
    }
    void post(
      `/api/admin/orders/${orderId}/mark-shipped`,
      trackingNo ? { carrier, trackingNo } : { carrier },
    );
  }

  if (done) {
    return (
      <div className="notice" role="status">
        <p className="notice__title">Action enregistrée</p>
        <p style={{ margin: 0 }}>{done}</p>
      </div>
    );
  }

  if (!showMarkPaid && !showMarkShipped) {
    return (
      <p className="admin-muted">
        Aucune action manuelle n&apos;est disponible pour une commande au statut
        actuel. Les transitions de paiement viennent du prestataire de paiement.
      </p>
    );
  }

  return (
    <div className="admin-stack">
      {showMarkPaid ? (
        <form onSubmit={onMarkPaid} className="admin-stack">
          <p className="form-field__hint">
            Virement bancaire en attente : vérifiez l&apos;arrivée des fonds sur votre compte
            bancaire avant de confirmer. Cette action décrémente le stock réservé et envoie
            l&apos;email de confirmation au client.
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Enregistrement…" : "Marquer comme payée"}
            </button>
          </div>
        </form>
      ) : null}

      {showMarkShipped ? (
        <form onSubmit={onMarkShipped} className="admin-stack">
          <div className="form-grid form-grid--2">
            <label className="form-field">
              <span className="form-field__label">Transporteur</span>
              <input
                type="text"
                name="carrier"
                required
                maxLength={80}
                defaultValue="Transporteur démo"
                autoComplete="off"
              />
            </label>
            <label className="form-field">
              <span className="form-field__label">Numéro de suivi</span>
              <input
                type="text"
                name="trackingNo"
                maxLength={80}
                placeholder="Ex. CP-123456"
                autoComplete="off"
              />
            </label>
          </div>
          <p className="form-field__hint">
            Laisser le numéro vide génère une référence de démonstration. Un email
            d&apos;expédition est envoyé au client.
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Enregistrement…" : "Marquer comme expédiée"}
            </button>
          </div>
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
