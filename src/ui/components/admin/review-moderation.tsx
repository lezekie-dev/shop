"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Actions de modération d'un avis : approuver / rejeter (F3).
 *
 * POURQUOI UN MOTIF LIBRE SUR LE REJET : un avis rejeté sans raison est
 * indiscutable, donc contesté. Le motif vit dans `AuditLog.diff.reason` (le
 * schéma n'a pas de colonne pour lui, et en ajouter une demanderait une
 * migration — interdit pendant la vague 2). Il sert à répondre au client qui
 * écrit « pourquoi mon avis n'est pas en ligne ? ».
 *
 * La confirmation native (`window.confirm`) est réservée au REJET : approuver
 * publie un avis, rejeter le fait disparaître définitivement de l'affichage
 * public. Les deux sont réversibles en base, mais une seule des deux
 * déclenchera une réclamation. Même logique que `PaymentActions`.
 */
export function ReviewModerationActions({
  reviewId,
  productName,
}: {
  reviewId: string;
  productName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  async function decide(decision: "approve" | "reject", motif: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason: motif }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? `L'action a échoué (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      // La ligne disparaît de la file : recharger le Server Component évite de
      // laisser à l'écran un avis déjà traité (et un compteur faux).
      router.refresh();
      setBusy(false);
      setShowReject(false);
    } catch {
      setError("Erreur réseau : la décision n'a pas été enregistrée.");
      setBusy(false);
    }
  }

  function onApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void decide("approve", null);
  }

  function onReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Double confirmation exigée pour une action qui sort un avis du circuit
    // public (cf. CONVENTIONS §6 : « toute action destructrice a une double
    // confirmation dans l'UI admin »).
    const ok = window.confirm(
      `Rejeter cet avis sur « ${productName} » ?\n\nIl ne sera jamais publié, et la décision sera journalisée avec son motif.`,
    );
    if (!ok) return;
    void decide("reject", reason.trim().length > 0 ? reason.trim() : null);
  }

  return (
    <div className="review-actions">
      <form onSubmit={onApprove} style={{ display: "inline" }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "…" : "Approuver"}
        </button>
      </form>

      {showReject ? (
        <form className="review-actions__reject" onSubmit={onReject}>
          <label className="form-field">
            <span className="form-field__label">Motif du rejet (facultatif, journalisé)</span>
            <input
              type="text"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex. : hors sujet, propos injurieux, contenu publicitaire"
            />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            {busy ? "…" : "Confirmer le rejet"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => setShowReject(true)}
        >
          Rejeter
        </button>
      )}

      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
