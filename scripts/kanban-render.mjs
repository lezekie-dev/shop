/**
 * Rend le kanban en image, à partir de `docs/team/kanban-data.json`.
 *
 * Pourquoi un rendu image et pas seulement du markdown : un kanban qu'on ne
 * voit pas n'est pas un kanban. Le fichier de données est la source (diffable,
 * versionnée), l'image est la vue qu'on regarde vraiment.
 *
 * Usage : node scripts/kanban-render.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "docs/team/kanban-data.json"), "utf8"));

const CREAM = "#faf6ef", SAND = "#f6efe1", INK = "#2a1810", BODY = "#4a3428";
const MUTED = "#8a7264", ACCENT = "#c2410c", BORDER = "#e8dcc4";

/** Couleur par chantier : repère visuel immédiat sur une carte. */
const TINT = {
  MVP: "#0f766e", SEC: "#9a3412", UI: "#7c3aed",
  V1: "#1d4ed8", I: "#b45309", J: "#0369a1", H: "#065f46", E: "#7c3aed",
  F: "#be185d", K: "#a16207", G: "#64748b", "—": "#8a7264",
};

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

function card(c) {
  const tint = TINT[c.id] ?? MUTED;
  return `<div class="card">
    <div class="card__top"><span class="badge" style="background:${tint}">${esc(c.id)}</span>
      <span class="team">${esc(c.team)}</span></div>
    <p class="card__title">${esc(c.title)}</p>
    <p class="card__proof">${esc(c.proof)}</p>
  </div>`;
}

/**
 * Regroupe les cartes d'une colonne.
 *
 * La colonne « Terminé » accumule une carte par tâche livrée depuis le début
 * du projet : à 24 cartes, le board devenait un ruban vertical de 2600 px,
 * illisible dans une fenêtre de chat — donc inutile, alors que son but est
 * d'être vu d'un coup d'œil. On la replie par lot (MVP, sécurité, design, V1,
 * lot 2A+2C) : une seule carte annonce ce qui a été livré et en quelle
 * quantité. Le détail par tâche reste dans `kanban-data.json`.
 *
 * Les autres colonnes gardent une carte par tâche : c'est là que le travail se
 * pilote, on veut donc voir chaque élément individuellement.
 */
function summarize(colId, cards) {
  if (colId !== "done") return cards;
  const groups = new Map();
  for (const c of cards) {
    const key = c.id;
    const g = groups.get(key) ?? { id: key, titles: [], team: c.team, proofs: [] };
    g.titles.push(c.title);
    g.proofs.push(c.proof);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    id: g.id,
    col: "done",
    title: `${g.titles.length} tâche${g.titles.length > 1 ? "s" : ""} livrée${g.titles.length > 1 ? "s" : ""}`,
    team: g.team,
    proof: g.titles.slice(0, 3).join(" · ") + (g.titles.length > 3 ? "…" : ""),
  }));
}

function column(col) {
  const all = data.cards.filter((c) => c.col === col.id);
  const cards = summarize(col.id, all);
  return `<div class="col">
    <div class="col__head">
      <span class="col__label">${esc(col.label)}</span>
      <span class="col__count">${col.id === "done" ? `${all.length} tâches · ${cards.length} lots` : cards.length}</span>
    </div>
    <p class="col__hint">${esc(col.hint)}</p>
    ${col.wip ? `<p class="col__wip">${esc(col.wip)}</p>` : ""}
    ${cards.map(card).join("")}
  </div>`;
}

const teamRows = data.team.map((t) => `<tr>
  <td><strong>${esc(t.role)}</strong></td><td>${esc(t.who)}</td><td class="muted">${esc(t.scope)}</td>
</tr>`).join("");

const decisionRows = data.decisions.map((d) => `<tr>
  <td class="mono">${esc(d.id)}</td><td>${esc(d.q)}</td><td class="accent">${esc(d.a)}</td>
</tr>`).join("");

const html = `<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{font:12.5px/1.42 ui-sans-serif,system-ui,sans-serif;background:${CREAM};color:${BODY};margin:0;padding:22px 20px 26px}
h1{font-family:Georgia,"Times New Roman",serif;font-size:1.7rem;letter-spacing:-.02em;color:${INK};margin:0 0 4px}
.sub{color:${MUTED};font-size:13px;margin:0 0 20px}
.rule{background:${SAND};border:1.5px solid ${BORDER};border-radius:10px;padding:12px 16px;margin-bottom:22px;font-size:13px}
.rule b{color:${INK}}
h2{font-family:Georgia,serif;font-size:1.15rem;color:${INK};margin:26px 0 10px;text-transform:uppercase;letter-spacing:.06em;font-size:.8rem}
.board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;align-items:start}
.col{background:#fff;border:1.5px solid ${BORDER};border-radius:12px;padding:12px;min-width:0}
.col__head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.col__label{font-weight:700;color:${INK};font-size:13.5px}
.col__count{background:${SAND};color:${INK};border-radius:99px;padding:1px 9px;font-size:12px;font-weight:700}
.col__hint{color:${MUTED};font-size:11px;margin:2px 0 10px;font-style:italic}
.col__wip{color:${ACCENT};font-size:10.5px;margin:0 0 10px;font-weight:600}
.card{border:1px solid ${BORDER};border-radius:7px;padding:6px 8px;margin-bottom:5px;background:${CREAM}}
.card__top{display:flex;align-items:center;gap:6px;justify-content:space-between;margin-bottom:5px}
.badge{color:#fffaf5;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:5px;letter-spacing:.04em}
.team{font-size:10.5px;color:${MUTED};text-align:right}
.card__title{font-weight:600;color:${INK};margin:0 0 2px;font-size:11.5px}
.card__proof{color:${MUTED};font-size:10px;margin:0}
table{width:100%;border-collapse:collapse;background:#fff;border:1.5px solid ${BORDER};border-radius:8px;overflow:hidden;font-size:11.5px}
th{background:${ACCENT};color:#fffaf5;text-align:left;padding:5px 9px;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
td{padding:5px 9px;border-bottom:1px solid ${BORDER}}
td.muted{color:${MUTED}}
td.accent{color:${ACCENT};font-weight:600}
td.mono{font-family:ui-monospace,monospace;font-size:12px;color:${MUTED}}
tr:last-child td{border-bottom:0}
</style></head><body>
<h1>Kanban — Projet Shop</h1>
<p class="sub">Mis à jour le ${esc(data.updatedAt)} · Chief of Staff · <strong>${data.cards.length} cartes</strong></p>
<div class="rule">
  <b>Règle d'or :</b> une carte passe en « Terminé » uniquement sur <b>preuve d'exécution</b> — tests verts et contrôle réel en production pour une carte visible.
  Jamais parce que le code est écrit, jamais parce qu'un agent l'affirme.
</div>
<h2>L'équipe</h2>
<table><tr><th>Rôle</th><th>Qui</th><th>Périmètre</th></tr>${teamRows}</table>
<h2>Le board</h2>
<div class="board">${data.columns.map(column).join("")}</div>
<h2>Décisions en attente du propriétaire</h2>
<table><tr><th>#</th><th>Question</th><th>Avis du PO (appliqué par défaut)</th></tr>${decisionRows}</table>
</body></html>`;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1 })).newPage();
await p.setContent(html);
await p.waitForTimeout(600);
await p.screenshot({ path: join(ROOT, "docs/team/kanban.png"), fullPage: true });
writeFileSync(join(ROOT, "docs/team/kanban.html"), html);
const h = await p.evaluate(() => document.body.scrollHeight);
console.log(`Kanban rendu : docs/team/kanban.png (${data.cards.length} cartes, hauteur ${h}px)`);
await b.close();
