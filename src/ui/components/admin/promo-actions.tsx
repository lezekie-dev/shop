"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Activation / désactivation d'un code promo depuis la liste.
 *
 * POURQUOI LA DÉSACTIVATION DEMANDE CONFIRMATION (CONVENTIONS §6) : elle coupe
 * une campagne en cours. Les remises DÉJÀ accordées ne sont pas reprises, mais
 * tout client qui tape le code à partir de cet instant voit son panier refusé —
 * un clic accidentel a donc un effet commercial immédiat et visible.
 *
 * Une seule route (`PATCH /api/admin/promos/[id]`) et un seul champ envoyé :
 * activer n'écrase jamais les dates ni les plafonds saisis.
 */
export function PromoActions({
  promoId,
  code,
  active,
}: {
  promoId: string;
  code: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (active) {
      const ok = window.confirm(
        `Désactiver le code ${code} ?\n\n` +
          "Il ne sera plus utilisable au panier ni à la commande. Les remises déjà accordées ne " +
          "sont pas reprises, et vous pourrez le réactiver d'un clic.",
      );
      if (!ok) return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/promos/${promoId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Échec (HTTP ${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("Erreur réseau : le code n'a pas été modifié.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="admin-inline">
      <button type="button" className="btn btn-secondary" onClick={toggle} disabled={busy}>
        {busy ? "…" : active ? "Désactiver" : "Activer"}
      </button>
      {error ? (
        <span className="form-feedback form-feedback--error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
