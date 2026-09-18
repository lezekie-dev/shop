/**
 * Logique de catalogue : recherche, tri, pagination des résultats.
 *
 * TypeScript PUR (cf. CONVENTIONS §2) : aucun import Next/Prisma, aucune
 * horloge, aucun aléa. On prend des structures de données, on rend des
 * structures de données.
 *
 * POURQUOI cette logique vit ici et pas dans la page :
 *  - le tri « prix » d'un produit est le prix de sa variante la MOINS CHÈRE.
 *    Cela dépend d'une relation Prisma, donc ce n'est pas exprimable en
 *    `orderBy` simple. Le tri est fait après récupération, sur un ensemble
 *    BORNÉ (cf. `CATALOG_SCAN_LIMIT`) ;
 *  - l'ordre réel des résultats se teste mieux sur une fonction pure que dans
 *    un test E2E qui vérifie « il y a 12 éléments » (et jamais leur ordre).
 */

/** Tri demandé par l'utilisateur. Union de littéraux (pas d'enum, cf. §7). */
export type CatalogSort = "recents" | "prix-asc" | "prix-desc";

/** Tri par défaut : ce que voit un visiteur qui n'a rien demandé. */
export const DEFAULT_CATALOG_SORT: CatalogSort = "recents";

/**
 * Nombre de produits par page. 12 = 1 colonne × 12 sur mobile, 3 colonnes × 4
 * sur desktop : la grille ne se termine jamais sur une rangée orpheline.
 */
export const CATALOG_PAGE_SIZE = 12;

/**
 * Nombre MAXIMAL de produits chargés depuis la base avant tri/pagination en
 * mémoire.
 *
 * POURQUOI une borne : le tri par prix ne peut pas être fait par PostgreSQL
 * sans sous-requête sur les variantes (donc sans `_min` par produit). Plutôt
 * que d'embarquer une requête SQL à la main, on charge un ensemble borné et on
 * trie en TypeScript. C'est acceptable au volume du MVP (catalogue de quelques
 * dizaines à quelques centaines de références) et c'est PRÉVISIBLE : on ne
 * charge jamais le catalogue entier, même s'il grossit.
 *
 * LIMITE ASSUMÉE (à lever quand le catalogue dépassera cette borne) :
 * au-delà de 300 produits actifs, la recherche et le tri ne portent que sur
 * les 300 produits les plus récents. Le jour où on la franchit, la sortie est
 * de faire le tri et le filtrage en SQL (`unaccent` + `LEFT JOIN LATERAL sur
 * MIN(prix)`) — le module `server/catalog.ts` expose `scanTruncated` pour que
 * l'UI le dise à l'utilisateur au lieu de mentir par omission.
 */
export const CATALOG_SCAN_LIMIT = 300;

/** Valeurs acceptées dans l'URL (`?tri=`), dans l'ordre d'affichage. */
export const CATALOG_SORTS: readonly CatalogSort[] = ["recents", "prix-asc", "prix-desc"];

/**
 * Produit tel que la logique de catalogue le voit (forme minimale, pas le
 * modèle Prisma : le domaine ne connaît pas la base).
 */
export interface CatalogListItem {
  id: string;
  slug: string;
  name: string;
  /** Optionnelle : un produit sans description reste trouvable par son nom. */
  description?: string | null;
  createdAt: Date;
  /** Prix de la variante la moins chère, en minor units. `null` = aucune
   *  variante active : le produit s'affiche « prix indisponible ». */
  minPriceCents: number | null;
}

/** Première valeur d'un paramètre d'URL (`?q=a&q=b` arrive en tableau). */
export function firstParam(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Normalise une requête de recherche : espaces multiples et insécables
 * réduits, longueur bornée.
 *
 * POURQUOI borner : la requête vient de l'URL. Une chaîne de 10 000 caractères
 * ferait un `includes()` de 10 000 caractères sur chaque produit analysé.
 */
export function normalizeQuery(raw: string | string[] | undefined): string {
  const value = firstParam(raw);
  if (typeof value !== "string") return "";
  return value.replace(/[\s\u00a0\u202f]+/g, " ").trim().slice(0, 80);
}

/**
 * Replie une chaîne pour la comparaison : minuscules + accents retirés.
 *
 * POURQUOI pas `mode: "insensitive"` de Prisma : ce mode ne gère que la
 * CASSE, pas les ACCENTS. « theiere » ne trouverait pas « Théière ».
 * POURQUOI pas l'extension PostgreSQL `unaccent` : elle demande une migration
 * (`CREATE EXTENSION`) et un privilège superutilisateur. Le repli ici se fait
 * en JavaScript, donc il est identique en base et en test — contrepartie
 * assumée : il s'applique aux produits chargés (ensemble borné), pas à toute
 * la table.
 */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // Diacritiques isolés par la décomposition NFD (é → e + ́ ).
    .replace(/[\u0300-\u036f]/g, "")
    // Ligatures que NFD ne décompose pas : « cœur », « œuf ».
    .replace(/\u0153/g, "oe")
    .replace(/\u00e6/g, "ae")
    // Apostrophes typographiques : le client tape « d'ete », la fiche dit
    // « d'été » avec une apostrophe courbe.
    .replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

/** Découpe une requête repliée en mots (tout ce qui n'est pas alphanumérique). */
export function tokenizeQuery(query: string): string[] {
  return foldText(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Rang de pertinence d'un produit pour une requête, ou `null` s'il ne
 * correspond pas.
 *
 * `0` = tous les mots sont dans le NOM, `1` = trouvés seulement via la
 * DESCRIPTION. Tous les mots doivent être présents (ET, pas OU) : « sac noir »
 * ne doit pas remonter tous les sacs ni tous les noirs.
 */
export function matchRank(
  item: Pick<CatalogListItem, "name" | "description">,
  query: string,
): number | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return null;

  const name = foldText(item.name);
  const haystack = `${name} ${foldText(item.description ?? "")}`;

  const inName = tokens.every((token) => name.includes(token));
  if (inName) return 0;
  const inHaystack = tokens.every((token) => haystack.includes(token));
  return inHaystack ? 1 : null;
}

/** Lit `?tri=` et retombe sur le tri par défaut si la valeur est inconnue. */
export function parseCatalogSort(raw: string | string[] | undefined): CatalogSort {
  const value = firstParam(raw);
  const found = CATALOG_SORTS.find((sort) => sort === value);
  return found ?? DEFAULT_CATALOG_SORT;
}

/**
 * Lit `?page=` : entier ≥ 1, sinon 1.
 * On ne lève pas d'erreur sur `?page=abc` : un catalogue qui renvoie une 500
 * parce qu'un robot a mal écrit son URL, c'est un bug de marchand.
 */
export function parsePageNumber(raw: string | string[] | undefined): number {
  const value = firstParam(raw);
  if (typeof value !== "string") return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * Compare deux prix pour un tri croissant/décroissant.
 *
 * INVARIANT : un produit sans variante active (prix `null`) finit TOUJOURS en
 * fin de liste, dans les deux sens. Le laisser en tête d'un tri décroissant
 * ferait ouvrir la page sur « Prix indisponible » — pire première impression
 * possible sur une page marchande.
 */
function comparePrice(a: CatalogListItem, b: CatalogListItem, direction: "asc" | "desc"): number {
  const av = a.minPriceCents;
  const bv = b.minPriceCents;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return direction === "asc" ? av - bv : bv - av;
}

/** Comparaison de noms : locale française, insensible aux accents. */
function compareName(a: CatalogListItem, b: CatalogListItem): number {
  return foldText(a.name).localeCompare(foldText(b.name), "fr");
}

/**
 * Trie les produits du catalogue.
 *
 * @param items   produits à trier (déjà bornés par l'appelant)
 * @param sort    tri demandé
 * @param relevance  id → rang de pertinence (cf. `matchRank`). Fourni
 *   uniquement quand une recherche est active.
 *
 * Règle de priorité (le POURQUOI, il est contre-intuitif) :
 *  - tri « nouveautés » + recherche → la PERTINENCE d'abord : un visiteur qui
 *    tape « theiere » veut la théière avant la parure de lit qui la mentionne
 *    dans sa description ;
 *  - tri par PRIX explicite → le prix d'abord. Un utilisateur qui clique
 *    « Prix croissant » a demandé un ordre économique précis ; le perturber
 *    pour remonter un meilleur « match » rendrait le tri incohérent. La
 *    pertinence ne sert alors que d'arbitrage à prix égal.
 *
 * Retourne un NOUVEAU tableau (pas de mutation de l'entrée : l'appelant peut
 * réutiliser sa liste bornée pour deux affichages).
 */
export function sortCatalogItems<T extends CatalogListItem>(
  items: readonly T[],
  sort: CatalogSort,
  relevance?: ReadonlyMap<string, number>,
): T[] {
  const rankOf = (item: T): number => relevance?.get(item.id) ?? 0;

  return [...items].sort((a, b) => {
    if (sort === "recents") {
      const byRank = rankOf(a) - rankOf(b);
      if (byRank !== 0) return byRank;
      const byDate = b.createdAt.getTime() - a.createdAt.getTime();
      if (byDate !== 0) return byDate;
    } else {
      const byPrice = comparePrice(a, b, sort === "prix-asc" ? "asc" : "desc");
      if (byPrice !== 0) return byPrice;
      const byRank = rankOf(a) - rankOf(b);
      if (byRank !== 0) return byRank;
    }
    // Départage final : le nom, puis l'id. Sans lui, deux produits au même
    // prix pourraient changer d'ordre entre deux rendus (tri non stable côté
    // affichage) — et le test ne saurait pas dire si l'ordre est correct.
    const byName = compareName(a, b);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

export interface CatalogPageOf<T> {
  items: T[];
  /** Page effectivement affichée (bornée à [1, pageCount]). */
  page: number;
  pageCount: number;
  /** Nombre total d'éléments APRÈS filtrage/recherche. */
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** Rang du premier élément affiché (1-indexé), 0 si la page est vide. */
  firstIndex: number;
  /** Rang du dernier élément affiché, 0 si la page est vide. */
  lastIndex: number;
}

/**
 * Découpe une liste en pages.
 *
 * Une page hors bornes est RAMENÉE dans les bornes plutôt que renvoyée vide :
 * `?page=99` sur un catalogue de 3 pages doit afficher la dernière page, pas
 * un état vide incompréhensible (les moteurs de recherche et les vieux liens
 * produisent ce genre d'URL).
 */
export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number = CATALOG_PAGE_SIZE,
): CatalogPageOf<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const start = (safePage - 1) * size;
  const pageItems = items.slice(start, start + size);

  return {
    items: pageItems,
    page: safePage,
    pageCount,
    total,
    hasPrev: safePage > 1,
    hasNext: safePage < pageCount,
    firstIndex: total === 0 ? 0 : start + 1,
    lastIndex: total === 0 ? 0 : start + pageItems.length,
  };
}

/** Vue complète d'une page de catalogue : recherche + tri + pagination. */
export interface CatalogView<T> extends CatalogPageOf<T> {
  /** Requête normalisée effectivement appliquée ("" = pas de recherche). */
  query: string;
  sort: CatalogSort;
}

export interface BuildCatalogViewInput<T extends CatalogListItem> {
  /**
   * Candidats RÉCUPÉRÉS DE LA BASE, bornés par l'appelant, déjà triés du plus
   * récent au plus ancien (l'ordre naturel de la requête).
   */
  items: readonly T[];
  query: string;
  sort: CatalogSort;
  page: number;
  pageSize?: number;
}

/**
 * Chaîne complète du catalogue : filtre de recherche, tri, pagination.
 *
 * POURQUOI une seule fonction : la page ne doit pas recomposer ces trois
 * étapes à sa façon — c'est exactement le genre d'endroit où un tri partiel
 * passe en production (on pagine avant de trier, par exemple).
 */
export function buildCatalogView<T extends CatalogListItem>(
  input: BuildCatalogViewInput<T>,
): CatalogView<T> {
  const { items, query, sort, page } = input;
  const normalized = normalizeQuery(query);

  const relevance = new Map<string, number>();
  let candidates: readonly T[] = items;

  if (normalized === "") {
    // Pas de recherche : on garde tout le catalogue chargé. C'est le cas le
    // plus fréquent (arrivée depuis la navigation), il ne coûte aucun filtre.
    candidates = items;
  } else {
    const matched: T[] = [];
    for (const item of items) {
      const rank = matchRank(item, normalized);
      if (rank === null) continue;
      relevance.set(item.id, rank);
      matched.push(item);
    }
    candidates = matched;
  }

  const sorted = sortCatalogItems(candidates, sort, normalized === "" ? undefined : relevance);
  const pageOf = paginateItems(sorted, page, input.pageSize ?? CATALOG_PAGE_SIZE);

  return { ...pageOf, query: normalized, sort };
}

/** Un numéro de page cliquable, ou un intervalle masqué (« … »). */
export type CatalogPageLink = number | "gap";

/**
 * Numéros de page à afficher : première, dernière, et fenêtre autour de la
 * page courante.
 *
 * POURQUOI ne pas lister les 40 pages : sur mobile, une pagination qui passe à
 * la ligne sur trois rangées pousse les produits hors de l'écran — elle
 * devient plus visible que le catalogue lui-même.
 */
export function catalogPageLinks(page: number, pageCount: number, span = 2): CatalogPageLink[] {
  const total = Math.max(1, Math.trunc(pageCount));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), total);
  const wanted = new Set<number>([1, total]);
  for (let p = current - span; p <= current + span; p++) {
    if (p >= 1 && p <= total) wanted.add(p);
  }

  const pages = Array.from(wanted).sort((a, b) => a - b);
  const links: CatalogPageLink[] = [];
  let previous = 0;
  for (const p of pages) {
    // Un « … » n'est posé que s'il masque AU MOINS une page : deux numéros
    // consécutifs (4, 5) n'ont pas besoin d'un trou entre eux.
    if (previous !== 0 && p - previous > 1) links.push("gap");
    links.push(p);
    previous = p;
  }
  return links;
}

export interface CatalogHrefParams {
  query?: string;
  sort?: CatalogSort;
  page?: number;
}

/**
 * Construit l'URL d'une page de catalogue (`/products` ou `/categorie/<slug>`)
 * en ne gardant QUE les paramètres utiles.
 *
 * POURQUOI ne pas recopier tous les `searchParams` : une URL qui traîne
 * `?page=1&tri=recents` produit des liens canoniques bizarres, indexables, et
 * une pagination qui semble ne pas avancer. On n'écrit un paramètre que s'il
 * change quelque chose.
 */
export function buildCatalogHref(basePath: string, params: CatalogHrefParams = {}): string {
  const search = new URLSearchParams();
  const query = normalizeQuery(params.query);
  if (query !== "") search.set("q", query);
  if (params.sort !== undefined && params.sort !== DEFAULT_CATALOG_SORT) {
    search.set("tri", params.sort);
  }
  if (params.page !== undefined && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs === "" ? basePath : `${basePath}?${qs}`;
}
