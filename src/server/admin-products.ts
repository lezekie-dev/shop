/**
 * Lecture produits / variantes / stock / outbox pour le back-office.
 *
 * Les pages admin n'importent jamais Prisma directement : elles passent par ce
 * module, qui renvoie des structures prêtes à afficher (aucun `Json` brut, aucun
 * `Decimal`, aucun objet Prisma qui fuit dans le JSX).
 *
 * Les helpers de mise en forme (niveau de stock, attributs) sont purs et testés
 * sans base.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { LOW_STOCK_THRESHOLD } from "@/server/admin-stats";

// ─────────────────────────────────────────────────────────────────────
// Helpers purs
// ─────────────────────────────────────────────────────────────────────

export type StockLevel = "out" | "low" | "ok";

/** Santé d'une variante : rupture, sous le seuil, ou confortable. */
export function stockLevel(
  available: number,
  threshold: number = LOW_STOCK_THRESHOLD,
): StockLevel {
  if (available <= 0) return "out";
  if (available <= threshold) return "low";
  return "ok";
}

/** Libellé humain d'une variante, jamais un statut porté par la couleur seule. */
export function stockLevelLabel(level: StockLevel): string {
  switch (level) {
    case "out":
      return "Rupture";
    case "low":
      return "Stock faible";
    case "ok":
      return "Disponible";
  }
}

/** Symbole associé au niveau (accessibilité : le sens ne dépend pas de la teinte). */
export function stockLevelSymbol(level: StockLevel): string {
  switch (level) {
    case "out":
      return "✕";
    case "low":
      return "!";
    case "ok":
      return "✓";
  }
}

/**
 * Rend un `attributes` Json sous forme lisible — "color : blanc · size : M".
 * Toute valeur non scalaire est ignorée : on n'imprime jamais "[object Object]".
 */
export function formatVariantAttributes(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return "—";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      ([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    )
    .map(([key, v]) => `${key} : ${String(v)}`);
  return entries.length > 0 ? entries.join(" · ") : "—";
}

/** Tri par urgence : rupture, puis disponible croissant, puis SKU. */
export function sortByAvailability<T extends { available: number; sku: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.available !== b.available) return a.available - b.available;
    return a.sku.localeCompare(b.sku);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Types de lecture
// ─────────────────────────────────────────────────────────────────────

export type AdminVariantRow = {
  id: string;
  sku: string;
  name: string;
  attributesLabel: string;
  priceCents: number;
  active: boolean;
  quantity: number;
  reserved: number;
  available: number;
  level: StockLevel;
};

export type AdminProductRow = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  categoryName: string;
  variantCount: number;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  availableUnits: number;
  lowestAvailable: number | null;
};

export type AdminProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string;
  active: boolean;
  categoryId: string;
  categoryName: string;
  updatedAt: Date;
  variants: AdminVariantRow[];
};

export type AdminCategoryOption = {
  id: string;
  name: string;
  slug: string;
};

export type AdminStockRow = AdminVariantRow & {
  productId: string;
  productName: string;
  productSlug: string;
};

export type AdminEmailRow = {
  id: string;
  to: string;
  subject: string;
  template: string;
  provider: string;
  sentAt: Date;
  orderId: string | null;
};

export type AdminEmailDetail = AdminEmailRow & {
  bodyText: string;
  bodyHtml: string | null;
};

// ─────────────────────────────────────────────────────────────────────
// Requêtes
// ─────────────────────────────────────────────────────────────────────

function toVariantRow(variant: {
  id: string;
  sku: string;
  name: string;
  attributes: Prisma.JsonValue;
  priceCents: number;
  active: boolean;
  stock: { quantity: number; reserved: number } | null;
}): AdminVariantRow {
  const quantity = variant.stock?.quantity ?? 0;
  const reserved = variant.stock?.reserved ?? 0;
  const available = quantity - reserved;
  return {
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    attributesLabel: formatVariantAttributes(variant.attributes),
    priceCents: variant.priceCents,
    active: variant.active,
    quantity,
    reserved,
    available,
    level: stockLevel(available),
  };
}

export async function listAdminProducts(): Promise<AdminProductRow[]> {
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: {
      category: { select: { name: true } },
      variants: {
        select: {
          priceCents: true,
          stock: { select: { quantity: true, reserved: true } },
        },
      },
    },
  });

  return products.map((product) => {
    const prices = product.variants.map((v) => v.priceCents);
    const availabilities = product.variants.map(
      (v) => (v.stock?.quantity ?? 0) - (v.stock?.reserved ?? 0),
    );
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      active: product.active,
      categoryName: product.category.name,
      variantCount: product.variants.length,
      priceMinCents: prices.length > 0 ? Math.min(...prices) : null,
      priceMaxCents: prices.length > 0 ? Math.max(...prices) : null,
      availableUnits: availabilities.reduce((acc, n) => acc + n, 0),
      lowestAvailable: availabilities.length > 0 ? Math.min(...availabilities) : null,
    };
  });
}

export async function getAdminProductDetail(id: string): Promise<AdminProductDetail | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      variants: {
        orderBy: { sku: "asc" },
        include: { stock: { select: { quantity: true, reserved: true } } },
      },
    },
  });
  if (!product) return null;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    active: product.active,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    updatedAt: product.updatedAt,
    variants: product.variants.map(toVariantRow),
  };
}

export async function listCategoryOptions(): Promise<AdminCategoryOption[]> {
  return prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
}

/** Vue stock consolidée : toutes les variantes, les plus contraintes en tête. */
export async function listStockOverview(): Promise<AdminStockRow[]> {
  const variants = await prisma.variant.findMany({
    include: {
      stock: { select: { quantity: true, reserved: true } },
      product: { select: { id: true, name: true, slug: true } },
    },
  });

  const rows: AdminStockRow[] = variants.map((variant) => ({
    ...toVariantRow(variant),
    productId: variant.product.id,
    productName: variant.product.name,
    productSlug: variant.product.slug,
  }));

  return sortByAvailability(rows);
}

export async function listOutboxEmails(limit = 50): Promise<AdminEmailRow[]> {
  return prisma.emailOutbox.findMany({
    orderBy: { sentAt: "desc" },
    take: limit,
    select: {
      id: true,
      to: true,
      subject: true,
      template: true,
      provider: true,
      sentAt: true,
      orderId: true,
    },
  });
}

export async function getOutboxEmail(id: string): Promise<AdminEmailDetail | null> {
  const email = await prisma.emailOutbox.findUnique({
    where: { id },
    select: {
      id: true,
      to: true,
      subject: true,
      template: true,
      provider: true,
      sentAt: true,
      orderId: true,
      bodyText: true,
      bodyHtml: true,
    },
  });
  return email ?? null;
}

/** Libellé humain d'un template d'email (jamais la clé technique seule). */
export function emailTemplateLabel(template: string): string {
  switch (template) {
    case "order_confirmation":
      return "Confirmation de commande";
    case "order_shipped":
      return "Expédition";
    default:
      return template;
  }
}
