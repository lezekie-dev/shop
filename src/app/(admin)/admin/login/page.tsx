"use client";

import { useState, type FormEvent } from "react";

/**
 * Connexion au back-office.
 *
 * DEUX TEMPS DANS UN SEUL FORMULAIRE : le mot de passe part toujours avec le
 * code TOTP s'il est saisi. Si le compte a la 2FA activée, le serveur répond
 * `TOTP_REQUIRED` et l'on révèle le champ de code — les champs email/mot de
 * passe restent remplis (inputs non contrôlés), donc la seconde soumission
 * renvoie les mêmes identifiants accompagnés du code. Aucun état intermédiaire
 * « à moitié authentifié » n'est stocké côté serveur : rien à expirer, rien à
 * voler.
 *
 * ── MIS EN FORME : cette page était la DERNIÈRE restée sur l'ancien style ──
 * Elle portait des valeurs écrites à la main (`#111` pour le bouton, bordures
 * 1px, rayon 6px, `#666` pour les légendes) alors que tout le reste de
 * l'application était passé au design system. C'est le défaut classique du
 * rattrapage partiel : un écran oublié suffit à faire paraître le produit
 * inachevé, et c'est celui que le marchand voit EN PREMIER.
 *
 * Elle utilise désormais les mêmes tokens que le reste : bouton terracotta en
 * pilule, bordures 1,5 px, rayons du système, textes chauds.
 */

/** Styles partagés par les trois champs — évite trois copies identiques. */
const champStyle: React.CSSProperties = {
  padding: "0.6875rem 0.875rem",
  border: "1.5px solid var(--border-strong)",
  borderRadius: "var(--r-md)",
  background: "var(--bg-raised)",
  color: "var(--text-strong)",
  fontSize: "var(--fs-body)",
  fontFamily: "var(--font-body)",
  width: "100%",
};

export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [method, setMethod] = useState<"totp" | "recovery" | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const totpCode = String(form.get("totpCode") ?? "").trim();
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(totpCode ? { totpCode } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (data.code === "TOTP_REQUIRED") {
          // Le mot de passe est bon : on demande le second facteur sans
          // afficher d'erreur (ce n'est pas un échec, c'est une étape).
          setNeedsTotp(true);
          setMethod("totp");
          setLoading(false);
          return;
        }
        if (data.code === "TOTP_INVALID" || data.code === "TOTP_REPLAY") {
          setNeedsTotp(true);
          setMethod("totp");
        }
        setError(data.error ?? "Identifiants invalides");
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/admin";
      window.location.href = next;
    } catch {
      setError("Erreur réseau");
      setLoading(false);
    }
  }

  return (
    <section className="login-page">
      <div className="login-page__card">
        <p className="eyebrow">Espace d&apos;administration</p>
        <h1 className="login-page__title">Connexion</h1>
        <p className="login-page__sub">
          Réservé à l&apos;équipe de la boutique.
        </p>

        <form onSubmit={onSubmit} className="login-page__form">
          <label className="login-page__field">
            <span className="login-page__label">Email</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              style={champStyle}
            />
          </label>

          <label className="login-page__field">
            <span className="login-page__label">Mot de passe</span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              style={champStyle}
            />
          </label>

          {needsTotp ? (
            <label className="login-page__field">
              <span className="login-page__label">Code de vérification</span>
              <input
                type="text"
                name="totpCode"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={32}
                placeholder="123456"
                style={{ ...champStyle, fontFamily: "var(--font-numeric)", letterSpacing: "0.12em" }}
              />
              <span className="login-page__hint">
                Code à 6 chiffres de votre application d&apos;authentification. Le code de
                secours fonctionne aussi.
              </span>
            </label>
          ) : null}

          {method === "totp" && !error ? (
            <p className="login-page__note">
              Ce compte est protégé par une double authentification.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="login-page__error">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={loading} className="btn btn-primary login-page__submit">
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </section>
  );
}
