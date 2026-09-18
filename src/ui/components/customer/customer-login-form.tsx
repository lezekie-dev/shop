"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/**
 * Formulaire de connexion client.
 *
 * La redirection après succès est faite en JavaScript (`window.location.href`)
 * et non via `useSearchParams` : le paramètre `?next=` posé par la garde de
 * page est lu au moment de l'envoi, et une navigation complète garantit que
 * toutes les pages rendues côté serveur repartent avec le nouveau cookie.
 */
export function CustomerLoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      const res = await fetch("/api/account/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Connexion impossible.");
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      // On n'accepte qu'un chemin interne : un `next` fourni par l'URL
      // (`?next=https://ailleurs.tld`) transformerait la page de connexion en
      // tremplin de redirection ouverte.
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/compte";
      window.location.href = target;
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="form-field">
        <span className="form-field__label">
          Email <span className="form-field__req">*</span>
        </span>
        <input type="email" name="email" required autoComplete="email" />
      </label>

      <label className="form-field">
        <span className="form-field__label">
          Mot de passe <span className="form-field__req">*</span>
        </span>
        <input type="password" name="password" required autoComplete="current-password" />
      </label>

      {error && (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </div>

      <p className="note">
        Pas encore de compte ? <Link href="/compte/inscription">Créez-en un</Link> — si vous avez
        déjà commandé en invité avec cet email, votre historique sera rattaché automatiquement.
      </p>
    </form>
  );
}
