"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/**
 * Formulaire de création de compte client.
 *
 * Le champ « confirmation » est vérifié CÔTÉ CLIENT uniquement : le serveur ne
 * reçoit qu'un mot de passe, et une faute de frappe non détectée ici coûterait
 * un compte inaccessible (aucune procédure de réinitialisation au MVP).
 */
export function CustomerRegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    const firstName = String(form.get("firstName") ?? "").trim();
    const lastName = String(form.get("lastName") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();

    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/account/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          ...(phone.length > 0 ? { phone } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Création de compte impossible.");
        setLoading(false);
        return;
      }
      window.location.href = "/compte";
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">
            Prénom <span className="form-field__req">*</span>
          </span>
          <input type="text" name="firstName" required maxLength={80} autoComplete="given-name" />
        </label>

        <label className="form-field">
          <span className="form-field__label">
            Nom <span className="form-field__req">*</span>
          </span>
          <input type="text" name="lastName" required maxLength={80} autoComplete="family-name" />
        </label>
      </div>

      <label className="form-field">
        <span className="form-field__label">
          Email <span className="form-field__req">*</span>
        </span>
        <input type="email" name="email" required autoComplete="email" />
        <p className="form-field__hint">
          Utilisez l&apos;email de vos commandes : elles apparaîtront dans votre espace.
        </p>
      </label>

      <label className="form-field">
        <span className="form-field__label">Téléphone</span>
        <input type="tel" name="phone" maxLength={40} autoComplete="tel" placeholder="+237 6 12 34 56 78" />
        <p className="form-field__hint">Facultatif — utile pour être appelé par le livreur.</p>
      </label>

      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">
            Mot de passe <span className="form-field__req">*</span>
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            maxLength={100}
            autoComplete="new-password"
          />
          <p className="form-field__hint">8 caractères minimum.</p>
        </label>

        <label className="form-field">
          <span className="form-field__label">
            Confirmation <span className="form-field__req">*</span>
          </span>
          <input
            type="password"
            name="passwordConfirmation"
            required
            minLength={8}
            maxLength={100}
            autoComplete="new-password"
          />
        </label>
      </div>

      {error && (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Création…" : "Créer mon compte"}
        </button>
      </div>

      <p className="note">
        Vous avez déjà un compte ? <Link href="/compte/connexion">Connectez-vous</Link>.
      </p>
    </form>
  );
}
