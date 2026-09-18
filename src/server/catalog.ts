import { Prisma } from "@prisma/client";

import {
  buildCatalogView,
  CATALOG_SCAN_LIMIT,
  type CatalogListItem,
  type CatalogSort,
  type CatalogView,
} from "@/domain/catalog";
import { prisma } from "@/lib/db";

/**
 * Accès aux données du catalogue public (lecture seule).
 *
 * POURQUOI dans `src/server/` : c'est la seule couche autorisée à parler à
 * Prisma (cf. CONVENTIONS §2). Les pages appellent ces fonctions et ne
 * connaissent ni les modèles ni les `select` — un changement de schéma ne
 * remonte donc pas dans l'UI.
 *
 * RÈGLE DE PERFORMANCE (cible mobile 3G) : jamais de `findMany()` sans
 * `take`, jamais d'`include` récursif. On sélectionne exactement les champs
 * affichés, plus la description (utile à la recherche, jamais envoyée au
 * client : seuls les 12 produits de la page partent dans le HTML).
 */

/**
 * Champs d'un produit pour une carte de catalogue.
 *
 * `images` et `variants` sont limités à UNE ligne chacun, triée :
 *  - `images` : le visuel de couverture (position 0) — les autres ne sont pas
 *    utilisés par la grille, les charger serait du poids mort ;
 *  - `variants` : la variante la moins chère, d'où le `orderBy priceCents asc`
 *    + `take 1`. C'est ce qui donne le « à partir de X € » sans charger tout
 *    le catalogue de variantes (N+1 évité à la source).
 *
 * `width`/`height` accompagnent l'URL : sans dimensions, le navigateur ne
 * réserve pas la place et la page saute à l'arrivée de chaque image — le
 * défaut le plus visible sur une connexion lente.
 */
const CATALOG_PRODUCT_SELECT = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  slug: true,
  name: true,
  description: true,
  createdAt: true,
  category: { select: { name: true, slug: true } },
  images: {
    orderBy: { position: "asc" },
    take: 1,
    select: { url: true, alt: true, width: true, height: true },
  },
  variants: {
    where: { active: true },
    orderBy: { priceCents: "asc" },
    take: 1,
    select: { priceCents: true },
  },
});

type CatalogProductRow = Prisma.ProductGetPayload<{ select: typeof CATALOG_PRODUCT_SELECT }>;

export interface CatalogImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Produit affichable dans une grille de catalogue. */
export interface CatalogProduct extends CatalogListItem {
  categoryName: string;
  categorySlug: string;
  image: CatalogImage | null;
}

/** Résultat d'une page de catalogue, prêt pour le rendu. */
export interface CatalogResult {
  view: CatalogView<CatalogProduct>;
  /**
   * `true` si le chargement a buté sur `CATALOG_SCAN_LIMIT` : la recherche et
   * le tri n'ont alors porté que sur une partie du catalogue. L'UI le DIT à
   * l'utilisateur plutôt que de laisser croire à un résultat exhaustif.
   */
  scanTruncated: boolean;
}

/** Catégorie telle que la navigation et les pastilles de filtre l'affichent. */
export interface CategoryNavItem {
  id: string;
  slug: string;
  name: string;
  position: number;
  /** Nombre de produits ACTIFS (un produit dépublié ne compte pas). */
  productCount: number;
}

export interface CatalogQueryOptions {
  query: string;
  /** Slug de catégorie, ou `null` pour tout le catalogue. */
  categorySlug: string | null;
  sort: CatalogSort;
  page: number;
  /** Taille de page, utile aux tests. Par défaut `CATALOG_PAGE_SIZE`. */
  pageSize?: number;
}

function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  const cover = row.images[0] ?? null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    categoryName: row.category.name,
    categorySlug: row.category.slug,
    // `variants[0]` est déjà la moins chère : la requête a trié et borné.
    minPriceCents: row.variants[0]?.priceCents ?? null,
    image: cover
      ? { url: cover.url, alt: cover.alt, width: cover.width, height: cover.height }
      : null,
  };
}

/**
 * Charge une page de catalogue : candidats bornés depuis la base, puis
 * recherche + tri + pagination en mémoire (`buildCatalogView`).
 */
export async function loadCatalog(options: CatalogQueryOptions): Promise<CatalogResult> {
  const rows = await prisma.product.findMany({
    where: {
      active: true,
      // Le filtre catégorie reste en SQL : c'est un index, il ne coûte rien et
      // il évite de charger des produits qu'on jetterait ensuite.
      ...(options.categorySlug === null ? {} : { category: { slug: options.categorySlug } }),
    },
    // Ordre par défaut : plus récent d'abord. En cas d'égalité de date, le tri
    // final (name puis id) rend l'ordre déterministe.
    orderBy: { createdAt: "desc" },
    take: CATALOG_SCAN_LIMIT,
    select: CATALOG_PRODUCT_SELECT,
  });

  const view = buildCatalogView({
    items: rows.map(toCatalogProduct),
    query: options.query,
    sort: options.sort,
    page: options.page,
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  });

  return { view, scanTruncated: rows.length === CATALOG_SCAN_LIMIT };
}

/**
 * Catégories du catalogue dans l'ordre d'affichage VOULU PAR LE MARCHAND.
 *
 * `position` est un champ manuel (cf. schéma) : l'ordre alphabétique n'est
 * presque jamais l'ordre commercial. Le nom ne sert que de départage quand
 * deux catégories partagent la même position.
 */
export async function loadCategoryNav(): Promise<CategoryNavItem[]> {
  const rows = await prisma.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      position: true,
      _count: { select: { products: { where: { active: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    position: row.position,
    productCount: row._count.products,
  }));
}

/**
 * Catégories pour l'en-tête du site.
 *
 * POURQUOI ce n'est pas `loadCategoryNav()` directement dans le layout :
 * l'en-tête est rendu sur TOUTES les pages, y compris `/admin/login`. Si la
 * base est indisponible ou la table vide, la navigation ne doit pas faire
 * tomber la page — on affiche simplement « Boutique » sans les catégories.
 * Sans ce garde-fou, un incident sur une requête de confort bloque la
 * connexion au back-office, qui sert justement à réparer la boutique.
 */
export async function loadHeaderCategories(): Promise<CategoryNavItem[]> {
  try {
    return await loadCategoryNav();
  } catch {
    return [];
  }
}

/** Catégorie par slug, ou `null` (la page appelante décide du 404). */
export async function findCategoryBySlug(slug: string): Promise<{
  id: string;
  slug: string;
  name: string;
  position: number;
} | null> {
  return prisma.category.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, position: true },
  });
}

export interface CategoryPageResult extends CatalogResult {
  category: { id: string; slug: string; name: string; position: number };
}

/**
 * Charge une page de catégorie, ou `null` si le slug n'existe pas.
 *
 * Les deux requêtes partent en parallèle : un slug inconnu coûte alors une
 * requête produit inutile (0 ligne, coût négligeable) mais un slug connu ne
 * paie pas un aller-retour supplémentaire — le cas fréquent, lui, est dans le
 * chemin critique.
 */
export async function loadCategoryPage(
  slug: string,
  options: Omit<CatalogQueryOptions, "categorySlug">,
): Promise<CategoryPageResult | null> {
  const [category, result] = await Promise.all([
    findCategoryBySlug(slug),
    loadCatalog({
      query: options.query,
      categorySlug: slug,
      sort: options.sort,
      page: options.page,
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
    }),
  ]);

  if (category === null) return null;
  return { category, ...result };
}
