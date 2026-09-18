import type { Metadata } from "next";
import Link from "next/link";

import { readKanbanData } from "@/server/kanban";

export const metadata: Metadata = {
  title: "Kanban — Projet Shop",
  description: "État d'avancement du projet : qui fait quoi, sur quelle preuve.",
};

export const dynamic = "force-dynamic";

/**
 * Le board, consultable à une URL ET lisible sans les images.
 *
 * ── Pourquoi cette page existe ───────────────────────────────────────
 * Le kanban vivait uniquement dans `docs/team/kanban.png`. Deux problèmes :
 * un fichier dans un dépôt ne se consulte pas, et une version précédente était
 * rendue en 3120×6364 px — illisible. Son commanditaire ne le voyait donc pas.
 *
 * ── Pourquoi le contenu est aussi rendu en TEXTE ─────────────────────
 * Une page qui n'affiche qu'une image ne dit rien à qui ne voit pas l'image :
 * lecteur d'écran, image bloquée, connexion qui coupe. Les cartes, l'équipe et
 * les décisions sont donc rendus en HTML, lisibles et sélectionnables ;
 * l'image reste en second, comme vue d'ensemble visuelle.
 *
 * La source reste `docs/team/kanban-data.json` — le texte ET l'image en
 * découlent, donc ils ne peuvent pas diverger.
 */
export default async function KanbanPage() {
  const data = await readKanbanData();

  const counters = data.columns.map((col) => ({
    ...col,
    count: data.cards.filter((c) => c.col === col.id).length,
  }));

  return (
    <div className="shop-container">
      <div className="page">
        <div className="page__head enter enter-1">
          <div>
            <p className="eyebrow">Pilotage du projet</p>
            <h1 className="page__title">Kanban</h1>
            <p className="page__sub">
              Mis à jour le <span className="num">{data.updatedAt}</span> ·{" "}
              <span className="num">{data.cards.length}</span> cartes. Une carte ne passe en
              « Terminé » que sur <strong>preuve d&apos;exécution</strong> — jamais parce que le
              code est écrit.
            </p>
          </div>
        </div>

        {/* ── Compteurs ── */}
        <section className="section enter enter-2">
          <ul className="kanban-stats">
            {counters.map((col) => (
              <li key={col.id} className={`kanban-stats__item kanban-stats__item--${col.id}`}>
                <span className="kanban-stats__count num">{col.count}</span>
                <span className="kanban-stats__label">{col.label}</span>
                <span className="kanban-stats__hint">{col.hint}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── L'équipe ── */}
        <section className="section enter enter-3">
          <div className="section__head">
            <div>
              <p className="eyebrow">Organisation</p>
              <h2 className="section__title">L&apos;équipe</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table className="kanban-table">
              <thead>
                <tr>
                  <th scope="col">Rôle</th>
                  <th scope="col">Qui</th>
                  <th scope="col">Périmètre</th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((t) => (
                  <tr key={t.role}>
                    <th scope="row">{t.role}</th>
                    <td>{t.who}</td>
                    <td className="muted">{t.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Le board, colonne par colonne ── */}
        <section className="section enter enter-4">
          <div className="section__head">
            <div>
              <p className="eyebrow">Avancement</p>
              <h2 className="section__title">Le board</h2>
            </div>
          </div>

          <div className="kanban-board">
            {counters.map((col) => {
              const cards = data.cards.filter((c) => c.col === col.id);
              return (
                <div key={col.id} className="kanban-col">
                  <div className="kanban-col__head">
                    <span className="kanban-col__label">{col.label}</span>
                    <span className="kanban-col__count num">{cards.length}</span>
                  </div>
                  {col.wip && <p className="kanban-col__wip">{col.wip}</p>}
                  {cards.length === 0 ? (
                    <p className="kanban-col__empty">Aucune carte.</p>
                  ) : (
                    <ul className="kanban-cards">
                      {cards.map((c, i) => (
                        <li key={`${c.id}-${i}`} className="kanban-card">
                          <div className="kanban-card__top">
                            <span className="kanban-card__badge">{c.id}</span>
                            <span className="kanban-card__team">{c.team}</span>
                          </div>
                          <p className="kanban-card__title">{c.title}</p>
                          <p className="kanban-card__proof">{c.proof}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Décisions en attente ── */}
        <section className="section enter enter-5">
          <div className="section__head">
            <div>
              <p className="eyebrow">Arbitrages</p>
              <h2 className="section__title">Décisions en attente du propriétaire</h2>
            </div>
          </div>
          <p className="section__sub">
            Sans réponse, l&apos;avis du PO s&apos;applique par défaut et reste inscrit
            « à confirmer ».
          </p>
          <div className="table-wrap">
            <table className="kanban-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Question</th>
                  <th scope="col">Avis du PO (par défaut)</th>
                </tr>
              </thead>
              <tbody>
                {data.decisions.map((d) => (
                  <tr key={d.id}>
                    <th scope="row" className="mono">
                      {d.id}
                    </th>
                    <td>{d.q}</td>
                    <td className="accent">{d.a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Vue d'ensemble visuelle ── */}
        <section className="section enter enter-5">
          <div className="section__head">
            <div>
              <p className="eyebrow">Vue d&apos;ensemble</p>
              <h2 className="section__title">Le board en une image</h2>
            </div>
            <a href="/team/kanban.png" target="_blank" rel="noreferrer" className="section__link">
              Ouvrir en grand →
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- image
              statique régénérée par script : le loader de Next n'apporterait
              rien et recompresserait le texte du board. */}
          <img src="/team/kanban.png" alt="Kanban du projet, vue d'ensemble" className="kanban-image" />
        </section>

        <p className="note enter enter-5" style={{ marginTop: "var(--sp-4)" }}>
          Source des données : <code>docs/team/kanban-data.json</code> · Rendu image :{" "}
          <code>scripts/kanban-render.mjs</code> ·{" "}
          <Link href="/admin">retour au back-office</Link>
        </p>
      </div>
    </div>
  );
}
