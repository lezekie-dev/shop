"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Création d'un utilisateur interne (POST /api/admin/users).
 *
 * Deux choix par défaut volontaires :
 *   - le rôle pré-sélectionné est STAFF (moindre privilège) : donner les droits
 *     d'administration doit être un geste explicite, pas un oubli ;
 *   - le formulaire est vidé après succès : le mot de passe ne doit pas rester
 *     dans le DOM d'un navigateur partagé par plusieurs opérateurs.
 */
export function UserCreateForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [role, setRole] = useState<"STAFF" | "ADMIN">("STAFF");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      email: String(data.get("email") ?? "").trim(),
      name: String(data.get("name") ?? "").trim() || null,
      role: String(data.get("role") ?? "STAFF"),
      password: String(data.get("password") ?? ""),
    };

    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Échec de la création (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      form.reset();
      setRole("STAFF");
      setCreated(`Compte créé pour ${payload.email}. Communiquez-lui son mot de passe de vive voix.`);
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau : le compte n'a pas été créé.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Email</span>
          <input type="email" name="email" required maxLength={200} autoComplete="off" />
          <span className="form-field__hint">Sert d&apos;identifiant de connexion.</span>
        </label>
        <label className="form-field">
          <span className="form-field__label">Nom</span>
          <input type="text" name="name" maxLength={120} autoComplete="off" />
          <span className="form-field__hint">Facultatif — affiché dans la liste.</span>
        </label>
      </div>

      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Rôle</span>
          <select name="role" value={role} onChange={(e) => setRole(e.target.value as "STAFF" | "ADMIN")}>
            <option value="STAFF">Opérateur — commandes et expéditions</option>
            <option value="ADMIN">Administrateur — accès complet</option>
          </select>
          <span className="form-field__hint">
            {role === "STAFF"
              ? "Pas d'accès au catalogue, aux utilisateurs ni aux remboursements."
              : "Peut tout faire, y compris gérer les utilisateurs et les paramètres."}
          </span>
        </label>
        <label className="form-field">
          <span className="form-field__label">Mot de passe initial</span>
          <input
            type="password"
            name="password"
            required
            minLength={10}
            maxLength={200}
            autoComplete="new-password"
          />
          <span className="form-field__hint">10 caractères minimum (bcrypt ne lit que les 72 premiers octets).</span>
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Création…" : "Créer le compte"}
        </button>
      </div>

      {created ? (
        <p className="form-feedback form-feedback--ok" role="status">
          {created}
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
