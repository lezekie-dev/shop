"use client";

import { useState } from "react";

/**
 * Déconnexion client — POST /api/account/logout (204).
 *
 * Le formulaire fonctionne sans JavaScript (action POST native) ; le handler
 * client, quand il tourne, enchaîne sur l'accueil au lieu de laisser
 * l'utilisateur sur une page vide après le 204.
 *
 * `router.refresh()` n'est pas utilisé : après déconnexion, tout le contenu
 * rendu côté serveur (commandes, adresses) doit disparaître, un simple
 * rafraîchissement de route ne le garantit pas.
 */
export function CustomerLogoutButton() {
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/account/logout", { method: "POST" });
    } catch {
      // Cookie peut-être déjà invalidé : on termine la navigation quand même.
    }
    window.location.href = "/compte/connexion";
  }

  return (
    <form action="/api/account/logout" method="post" onSubmit={submit}>
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        {busy ? "Déconnexion…" : "Se déconnecter"}
      </button>
    </form>
  );
}
