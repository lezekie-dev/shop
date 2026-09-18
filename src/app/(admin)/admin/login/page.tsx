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
 */
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
    <section style={{ maxWidth: 360, margin: "3rem auto" }}>
      <h1>Connexion admin</h1>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Réservé aux utilisateurs back-office.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem", marginTop: "1.5rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>Mot de passe</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>
        {needsTotp ? (
          <label style={{ display: "grid", gap: "0.25rem" }}>
            <span>Code de vérification</span>
            <input
              type="text"
              name="totpCode"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={32}
              placeholder="123456"
              style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
            />
            <span style={{ color: "#666", fontSize: "0.8rem" }}>
              Code à 6 chiffres de votre application d&apos;authentification. Le code de secours
              fonctionne aussi.
            </span>
          </label>
        ) : null}
        {error ? (
          <p style={{ color: "#b00020", fontSize: "0.9rem", margin: 0 }}>{error}</p>
        ) : null}
        {method === "totp" && !error ? (
          <p style={{ color: "#666", fontSize: "0.85rem", margin: 0 }}>
            Ce compte est protégé par une double authentification.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.6rem 1rem",
            background: "#111",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </section>
  );
}
