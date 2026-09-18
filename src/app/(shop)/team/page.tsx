import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Kanban — Projet Shop",
  description: "État d'avancement du projet : qui fait quoi, sur quelle preuve.",
};

/**
 * Le board consultable à une URL.
 *
 * ── Pourquoi cette page existe ───────────────────────────────────────
 * Le kanban vivait uniquement dans `docs/team/kanban.png` : un fichier dans un
 * dépôt ne se consulte pas, il faut le cloner et l'ouvrir. Il était aussi rendu
 * en 3120×6364 px, donc illisible en aperçu. Résultat : son commanditaire ne le
 * voyait pas.
 *
 * Le rendu est maintenant servi ici, et `scripts/kanban-render.mjs` écrit
 * directement dans `public/`. Le fichier source reste
 * `docs/team/kanban-data.json` — l'image est régénérée par script, jamais
 * retouchée à la main.
 *
 * Page volontairement en Server Component : elle n'a aucun état, seulement une
 * image et un lien vers sa source.
 */
export default function KanbanPage() {
  return (
    <div className="shop-container">
      <div className="page">
        <div className="page__head enter enter-1">
          <div>
            <p className="eyebrow">Pilotage du projet</p>
            <h1 className="page__title">Kanban</h1>
            <p className="page__sub">
              Mis à jour à chaque vague. Une carte ne passe en « Terminé » que sur{" "}
              <strong>preuve d&apos;exécution</strong> — jamais parce que le code est écrit.
            </p>
          </div>
        </div>

        <div className="enter enter-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- image
              statique régénérée par script : le loader d'optimisation de Next
              n'apporterait rien et recompresserait le texte du board. */}
          <img
            src="/team/kanban.png"
            alt="Kanban du projet : backlog, en cours, à vérifier, terminé — avec l'équipe et les décisions en attente"
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              border: "1.5px solid var(--border-soft)",
              borderRadius: "var(--r-lg)",
            }}
          />
        </div>

        <p className="note enter enter-3" style={{ marginTop: "var(--sp-4)" }}>
          Source des données : <code>docs/team/kanban-data.json</code> · Rendu :{" "}
          <code>scripts/kanban-render.mjs</code> ·{" "}
          <a href="/team/kanban.png" target="_blank" rel="noreferrer">
            ouvrir l&apos;image en grand
          </a>{" "}
          · <Link href="/admin">retour au back-office</Link>
        </p>
      </div>
    </div>
  );
}
