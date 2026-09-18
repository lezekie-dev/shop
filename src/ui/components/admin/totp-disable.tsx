"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Désactivation de la 2FA de l'utilisateur connecté
 * (POST /api/admin/2fa/disable).
 *
 * Un code est EXIGÉ : la session ne suffit pas. C'est le second facteur qui doit
 * résister à un cookie volé — sinon il n'apporte rien. Le code de secours est
 * accepté, c'est le chemin de celui qui a perdu son téléphone.
 *
 * Contrepartie assumée du côté base : `totpSecret` est effacé, donc l'ancien QR
 * code (imprimé, photographié, retrouvé) ne vaut plus rien ; il faudra tout
 * ré-enrôler, ce qui génère un secret neuf.
 */
export function TotpDisable() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").trim();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/2fa/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Désactivation refusée (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      form.reset();
      setDone(
        "Double authentification désactivée. Votre connexion ne demande plus de code tant que vous ne la réactivez pas.",
      );
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau : la 2FA n'a pas été désactivée.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <p className="form-field__hint" style={{ margin: 0 }}>
        Pour désactiver, saisissez un code TOTP courant ou votre code de secours. Perdre son
        téléphone sans son code de secours impose de ré-enrôler la 2FA depuis un autre
        administrateur — c&apos;est précisément ce que le second facteur doit coûter.
      </p>
      <label className="form-field form-field--narrow">
        <span className="form-field__label">Code TOTP ou code de secours</span>
        <input type="text" name="code" required maxLength={32} autoComplete="one-time-code" />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? "Vérification…" : "Désactiver la double authentification"}
        </button>
      </div>
      {done ? (
        <p className="form-feedback form-feedback--ok" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
