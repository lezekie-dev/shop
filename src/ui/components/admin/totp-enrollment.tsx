"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { IconKey } from "@/ui/components/icons";
import { formatTotpSecret } from "@/ui/format";

/**
 * Enrôlement TOTP de l'utilisateur connecté (POST /api/admin/2fa/enroll puis
 * POST /api/admin/2fa/confirm).
 *
 * DEUX TEMPS, ET C'EST VOULU : l'API d'enrôlement enregistre le secret mais
 * N'ACTIVE PAS la 2FA ; seule la validation du premier code l'active. Si
 * l'utilisateur ferme l'onglet entre les deux — cas très courant — son compte
 * reste accessible avec son mot de passe seul, et il retrouve son enrôlement en
 * cours en revenant ici.
 *
 * POURQUOI LE SECRET EST AFFICHÉ EN TEXTE : il n'y a aucune dépendance de
 * génération de QR code dans le projet, et en ajouter une pour afficher un
 * carré noir et blanc serait disproportionné (une lib de QR, c'est du Reed-
 * Solomon, un pipeline de masquage…). Le format affiché est celui que TOUS les
 * authenticators acceptent en saisie manuelle — le secret base32 — et l'URI
 * `otpauth://` complète est fournie pour les clients qui l'acceptent.
 */

export type EnrollmentState = {
  secret: string;
  otpAuthUri: string;
  recoveryCode: string;
  issuer: string;
};

export function TotpEnrollment({ pending }: { pending: EnrollmentState | null }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<EnrollmentState | null>(pending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/2fa/enroll", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as Partial<EnrollmentState> & { error?: string };
      if (!res.ok || !body.secret || !body.otpAuthUri || !body.recoveryCode) {
        setError(body.error ?? `Échec de l'enrôlement (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      setEnrollment({
        secret: body.secret,
        otpAuthUri: body.otpAuthUri,
        recoveryCode: body.recoveryCode,
        issuer: body.issuer ?? "Shop",
      });
      setBusy(false);
    } catch {
      setError("Erreur réseau : l'enrôlement n'a pas démarré.");
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/2fa/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Code refusé (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      form.reset();
      setConfirmed(true);
      setBusy(false);
      // La page est un Server Component : ce refresh la relit avec
      // `totpEnabledAt` renseigné et bascule sur l'état « active ».
      router.refresh();
    } catch {
      setError("Erreur réseau : code non vérifié.");
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <p className="form-feedback form-feedback--ok" role="status">
        Double authentification activée. Elle sera demandée à votre prochaine connexion.
      </p>
    );
  }

  if (!enrollment) {
    return (
      <div className="admin-stack">
        <p style={{ margin: 0 }}>
          Aucune application d&apos;authentification n&apos;est encore associée à ce compte. Vous
          garderez votre mot de passe : la 2FA ajoute un code à 6 chiffres, renouvelé toutes les
          30 secondes.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? "Génération…" : "Activer la double authentification"}
          </button>
        </div>
        {error ? (
          <p className="form-feedback form-feedback--error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="admin-stack">
      {pending ? (
        <div className="notice">
          <p className="notice__title">Enrôlement en cours, non confirmé</p>
          <p style={{ margin: 0 }}>
            Le code n&apos;a jamais été validé : la double authentification n&apos;est PAS active et
            votre connexion se fait toujours avec le seul mot de passe. Terminez ci-dessous, ou
            générez un nouveau secret.
          </p>
        </div>
      ) : null}

      <ol className="steps-list">
        <li className="steps__item">
          <span className="steps__dot" aria-hidden>1</span>
          <span className="steps__label">
            Ouvrez votre application d&apos;authentification (Google Authenticator, Authy, 1Password,
            FreeOTP…).
          </span>
        </li>
        <li className="steps__item">
          <span className="steps__dot" aria-hidden>2</span>
          <span className="steps__label">
            Ajoutez un compte, puis saisissez ce secret (options « saisir une clé de configuration ») :
          </span>
        </li>
        <li className="steps__item">
          <span className="steps__dot" aria-hidden>3</span>
          <span className="steps__label">
            Saisissez le code à 6 chiffres affiché par l&apos;application pour valider.
          </span>
        </li>
      </ol>

      <div className="kv">
        <div className="kv__row">
          <span className="kv__label">Émetteur</span>
          <span className="kv__value">{enrollment.issuer}</span>
        </div>
        <div className="kv__row">
          <span className="kv__label">Secret (base32)</span>
          <span className="kv__value kv__value--num">
            <code className="steps-list__code">{formatTotpSecret(enrollment.secret)}</code>
          </span>
        </div>
      </div>
      <p className="form-field__hint" style={{ margin: 0 }}>
        L&apos;application règle l&apos;heure toute seule : vérifiez que le réglage automatique est
        activé, sinon les codes seront refusés. Les espaces du secret sont décoratifs.
      </p>

      <details>
        <summary>URI otpauth (pour un client qui accepte une URI)</summary>
        <pre className="mail-body">{enrollment.otpAuthUri}</pre>
      </details>

      <div className="notice">
        <p className="notice__title">
          <IconKey className="admin-nav__icon" aria-hidden /> Code de secours
        </p>
        <p>
          Notez-le maintenant, hors de l&apos;appareil : c&apos;est le seul moyen de vous connecter
          ou de désactiver la 2FA si vous perdez votre téléphone. Il est dérivé du secret de ce
          compte et ne peut pas être régénéré autrement qu&apos;en ré-enrôlant la 2FA.
        </p>
        <p className="kv__value kv__value--num" style={{ margin: 0 }}>
          <code className="steps-list__code">{enrollment.recoveryCode}</code>
        </p>
      </div>

      <form onSubmit={confirm} className="form-grid">
        <label className="form-field form-field--narrow">
          <span className="form-field__label">Code à 6 chiffres</span>
          <input
            type="text"
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={32}
            placeholder="123456"
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Vérification…" : "Valider et activer"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
