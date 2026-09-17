"use client";

import { useState, type FormEvent } from "react";

export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
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
        {error ? (
          <p style={{ color: "#b00020", fontSize: "0.9rem", margin: 0 }}>{error}</p>
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
