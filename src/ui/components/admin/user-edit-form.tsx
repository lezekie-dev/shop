"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { Role } from "@prisma/client";

/**
 * Édition d'un utilisateur interne (PATCH /api/admin/users/[id]).
 *
 * TROIS GARDE-FOUS D'INTERFACE, qui ne remplacent PAS le contrôle serveur :
 *
 * 1. DERNIER ADMIN ACTIF : le passage en STAFF et la désactivation sont
 *    désactivés et expliqués AVANT la tentative, parce qu'un 409 renvoyé par
 *    l'API après coup ressemble à un bug plutôt qu'à une règle métier.
 * 2. DÉSACTIVATION : double confirmation obligatoire (CONVENTIONS §6 — toute
 *    action destructrice en a une). L'action ferme les sessions en cours de la
 *    personne visée : elle ne doit pas partir d'un clic de trop.
 * 3. AUTO-MODIFICATION DU RÔLE : un avertissement dit explicitement que
 *    l'utilisateur perdra l'accès à cette page s'il se rétrograde.
 *
 * Le formulaire n'envoie QUE les champs modifiés : une sauvegarde sans
 * changement ne doit pas écrire une ligne d'audit trompeuse.
 */

export type UserEditValues = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  totpEnabled: boolean;
};

export function UserEditForm({
  user,
  activeAdmins,
  isSelf,
}: {
  user: UserEditValues;
  /** Nombre d'administrateurs actifs, pour expliquer la règle du dernier admin. */
  activeAdmins: number;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [confirmDeactivation, setConfirmDeactivation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const isLastActiveAdmin = user.active && user.role === "ADMIN" && activeAdmins <= 1;
  const willDeactivate = user.active && !active;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    const trimmedName = name.trim();
    const patch: Record<string, unknown> = {};
    if (email.trim() !== user.email) patch.email = email.trim();
    if (trimmedName !== (user.name ?? "")) patch.name = trimmedName === "" ? null : trimmedName;
    if (role !== user.role) patch.role = role;
    if (active !== user.active) patch.active = active;

    if (Object.keys(patch).length === 0) {
      setSaved("Aucune modification à enregistrer.");
      return;
    }
    if (willDeactivate && !confirmDeactivation) {
      setError("Cochez la confirmation de désactivation avant d'enregistrer.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Échec de l'enregistrement (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      setConfirmDeactivation(false);
      setSaved(
        active === false
          ? "Compte désactivé : ses sessions sont fermées et l'historique de ses actions est conservé."
          : "Compte enregistré.",
      );
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau : les modifications n'ont pas été enregistrées.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label className="form-field">
          <span className="form-field__label">Nom</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </label>
      </div>

      <div className="form-grid form-grid--2">
        <label className={`form-field${isLastActiveAdmin ? " form-field--disabled" : ""}`}>
          <span className="form-field__label">Rôle</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={isLastActiveAdmin}
          >
            <option value="STAFF">Opérateur — commandes et expéditions</option>
            <option value="ADMIN">Administrateur — accès complet</option>
          </select>
          <span className="form-field__hint">
            {isLastActiveAdmin
              ? "Seul administrateur actif : le rétrograder rendrait la boutique inadministrable."
              : isSelf && role !== user.role
                ? "Vous vous rétrogradez : vous perdrez l'accès à cette page dès l'enregistrement."
                : "Le changement de rôle prend effet à la requête suivante, sans attendre l'expiration de la session."}
          </span>
        </label>

        <div className={`form-field${isLastActiveAdmin ? " form-field--disabled" : ""}`}>
          <span className="form-field__label">État du compte</span>
          <span className="admin-inline">
            <input
              type="checkbox"
              id={`active-${user.id}`}
              checked={active}
              onChange={(e) => {
                setActive(e.target.checked);
                if (e.target.checked) setConfirmDeactivation(false);
              }}
              disabled={isLastActiveAdmin}
            />
            <label htmlFor={`active-${user.id}`}>Compte actif (peut se connecter)</label>
          </span>
          <span className="form-field__hint">
            {isLastActiveAdmin
              ? "Seul administrateur actif : le désactiver fermerait le back-office à tout le monde."
              : "Décocher ferme immédiatement les sessions ouvertes. La ligne et son historique d'audit sont conservés."}
          </span>
        </div>
      </div>

      {willDeactivate ? (
        <div className="notice">
          <p className="notice__title">Désactivation de {user.email}</p>
          <p style={{ marginBottom: "var(--sp-3)" }}>
            Ses sessions en cours sont fermées dans la seconde et il ne pourra plus se connecter.
            Rien n&apos;est supprimé : son historique d&apos;audit reste attaché à son compte, et la
            réactivation rouvre l&apos;accès.
          </p>
          <span className="admin-inline">
            <input
              type="checkbox"
              id={`confirm-${user.id}`}
              checked={confirmDeactivation}
              onChange={(e) => setConfirmDeactivation(e.target.checked)}
            />
            <label htmlFor={`confirm-${user.id}`}>
              Je confirme la désactivation de ce compte
            </label>
          </span>
        </div>
      ) : null}

      {user.totpEnabled ? (
        <div className="notice">
          <p className="notice__title">Double authentification active</p>
          <p style={{ margin: 0 }}>
            Ce compte exige un code TOTP à chaque connexion. Personne d&apos;autre ne peut le
            désactiver — l&apos;utilisateur le fait depuis « Sécurité » avec un de ses codes, ce qui
            empêche un administrateur de contourner le second facteur d&apos;un autre compte.
          </p>
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {saved ? (
        <p className="form-feedback form-feedback--ok" role="status">
          {saved}
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
