"use client";

import { useState } from "react";

/**
 * Déconnexion admin — POST /api/admin/logout (route existante, 204).
 *
 * Le formulaire reste fonctionnel sans JavaScript (action POST native) ; le
 * handler client, quand il tourne, enchaîne sur /admin/login au lieu de laisser
 * l'utilisateur sur une page vide après le 204.
 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Cookie peut-être déjà invalidé : on redirige quand même.
    }
    window.location.href = "/admin/login";
  }

  return (
    <form action="/api/admin/logout" method="post" onSubmit={submit}>
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        {busy ? "Déconnexion…" : "Se déconnecter"}
      </button>
    </form>
  );
}
