/**
 * Régénère les packshots produits en un style COHÉRENT.
 *
 * ── Pourquoi ce script existe ────────────────────────────────────────
 * Les 6 visuels d'origine avaient été produits à la main, en deux styles
 * différents : le t-shirt noir en aplat PLEIN, le blanc en simple CONTOUR.
 * Côte à côte dans la même grille, le produit sombre paraissait « fini » et
 * le clair « inachevé » — un défaut relevé à l'audit visuel, deux fois.
 *
 * Règle adoptée ici : TOUS les visuels sont pleins, avec une teinte de fond
 * propre au produit. C'est le seul traitement qui reste cohérent pour des
 * couleurs claires (un t-shirt blanc en aplat pur se confondrait avec le
 * fond crème) ET sombres (un noir en contour serait un liseré invisible).
 *
 * Ces visuels restent des DESSINS, pas des photos : ils servent à la
 * démonstration. Le chantier de téléversement d'images remplacera tout cela
 * par les vraies photos de la marchande (voir docs/team/KNOWN-ISSUES.md).
 *
 * Usage : node scripts/packshots.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "products");

/** Palette du site (voir src/ui/styles/tokens.css). */
const CREAM = "#faf6ef";
const SAND = "#f2e9d8";
const HALO = "#eadfc9";
const INK = "#2a1810";
const SHADOW = "rgba(42, 24, 16, 0.10)";

/**
 * Un produit = un dessin + une teinte de fond propre.
 *
 * Le fond est choisi POUR dégager la silhouette : fond clair pour un article
 * sombre, fond légèrement plus soutenu pour un article clair. Sans cette
 * distinction, un article blanc sur fond crème n'a plus de contour lisible.
 */
const PRODUCTS = {
  "tshirt-noir": { shape: "tshirt", fill: "#231610", stroke: "#0f0a07", bg: SAND },
  // Article CLAIR : fond nettement plus soutenu que la teinte du vêtement,
  // sinon la silhouette blanche disparaît dans un fond crème. Le contour est
  // franc pour la même raison.
  "tshirt-blanc": { shape: "tshirt", fill: "#fefdfb", stroke: "#a08a6e", bg: "#dfcdb0" },
  "casquette-noir": { shape: "cap", fill: "#231610", stroke: "#0f0a07", bg: SAND },
  "casquette-kaki": { shape: "cap", fill: "#6f6a4d", stroke: "#494530", bg: "#ecdfc4" },
  // Le tote naturel était le plus critique : sa teinte était presque celle du
  // fond. Fond assombri et contour renforcé.
  "tote-naturel": { shape: "tote", fill: "#dcc7a1", stroke: "#8f7a58", bg: "#e5d3b4" },
  "tote-noir": { shape: "tote", fill: "#231610", stroke: "#0f0a07", bg: SAND },
};

/** T-shirt à col V, manches courtes. */
function tshirt({ fill, stroke }) {
  return `
    <path d="M150 92 L196 74 Q250 116 304 74 L350 92 L392 176 L340 200 L336 404 Q250 424 164 404 L160 200 L108 176 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M196 74 Q250 118 304 74" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
    <path d="M202 82 Q250 122 298 82" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="0.55"/>
    <path d="M196 300 Q250 314 304 300" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="0.4"/>
    <path d="M196 340 Q250 354 304 340" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="0.28"/>
    <path d="M108 176 L160 200" stroke="${stroke}" stroke-width="3" opacity="0.35"/>
    <path d="M392 176 L340 200" stroke="${stroke}" stroke-width="3" opacity="0.35"/>`;
}

/** Casquette 6 panneaux, visière à gauche. */
function cap({ fill, stroke }) {
  return `
    <path d="M138 262 Q138 152 250 152 Q346 152 352 232 L352 262 Q250 292 138 262 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M172 168 Q250 208 336 176" fill="none" stroke="${stroke}" stroke-width="3.5" opacity="0.6"/>
    <path d="M250 154 L250 264" fill="none" stroke="${stroke}" stroke-width="3.5" opacity="0.45"/>
    <path d="M206 160 Q228 214 218 268" fill="none" stroke="${stroke}" stroke-width="3" opacity="0.35"/>
    <path d="M294 160 Q272 214 282 268" fill="none" stroke="${stroke}" stroke-width="3" opacity="0.35"/>
    <path d="M138 254 Q74 258 52 282 Q66 300 108 300 Q132 292 140 274 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="250" cy="150" r="9" fill="${fill}" stroke="${stroke}" stroke-width="3.5"/>
    <path d="M150 206 Q150 178 176 170" fill="none" stroke="${stroke}" stroke-width="3" opacity="0.5"/>`;
}

/** Sac tote à anses. */
function tote({ fill, stroke }) {
  return `
    <path d="M162 168 L338 168 L322 424 Q250 440 178 424 Z"
          fill="${fill}" stroke="${stroke}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M198 168 Q198 96 250 96 Q302 96 302 168" fill="none" stroke="${stroke}" stroke-width="7" stroke-linecap="round"/>
    <path d="M214 174 L206 418" fill="none" stroke="${stroke}" stroke-width="3" opacity="0.35"/>
    <path d="M286 174 L294 418" fill="none" stroke="${stroke}" stroke-width="3" opacity="0.35"/>
    <path d="M182 300 L318 300" fill="none" stroke="${stroke}" stroke-width="3" opacity="0.22"/>`;
}

const SHAPES = { tshirt, cap, tote };

/**
 * Construit le SVG complet : fond, halo, ombre au sol, produit.
 *
 * Le halo circulaire et l'ombre portée donnent l'impression d'une mise en
 * scène photo (le produit est posé, éclairé), ce qui évite l'effet « icône
 * posée à plat » qui faisait justement pauvre.
 */
function buildSvg(spec) {
  const draw = SHAPES[spec.shape];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="800" height="800" role="img">
  <defs>
    <radialGradient id="halo" cx="50%" cy="46%" r="52%">
      <stop offset="0%" stop-color="${HALO}"/>
      <stop offset="100%" stop-color="${spec.bg}"/>
    </radialGradient>
  </defs>
  <rect width="500" height="500" fill="${CREAM}"/>
  <rect width="500" height="500" fill="url(#halo)"/>
  <ellipse cx="250" cy="436" rx="150" ry="17" fill="${SHADOW}"/>
  ${draw({ fill: spec.fill, stroke: spec.stroke })}
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [name, spec] of Object.entries(PRODUCTS)) {
  const svg = buildSvg(spec);
  writeFileSync(join(OUT, `${name}.svg`), svg);
  n += 1;
}
console.log(`${n} SVG écrits dans public/products/ (style plein unifié).`);
console.log("Rendu PNG à faire via Chromium (voir la commande associée).");
