import { afterAll, beforeEach, describe, expect, it } from "vitest";

import CategoryPage from "@/app/(shop)/categorie/[slug]/page";
import ProductsListPage from "@/app/(shop)/products/page";
import {
  findCategoryBySlug,
  loadCatalog,
  loadCategoryNav,
  loadCategoryPage,
} from "@/server/catalog";

import { prismaTest, resetDb } from "../helpers/prisma-test";

/**
 * Tests d'intégration du catalogue — vraie base (shop_test), vrai Prisma.
 *
 * POURQUOI ils doublonnent en partie les tests unitaires : ceux-ci vérifient
 * que la REQUÊTE ramène bien ce qu'on croit (variantes actives, produits
 * dépubliés exclus, visuel de couverture, prix « à partir de »). Le tri, lui,
 * est testé en unitaire sur l'ordre réel — ici on vérifie seulement que les
 * données qui l'alimentent sont correctes.
 */

interface SeedVariant {
  priceCents: number;
  active: boolean;
}

interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  variants: SeedVariant[];
  active: boolean;
  /** Décalage en jours depuis le 1er janvier 2026 (ordre des nouveautés). */
  day: number;
}

/** Prix par variante : une seule variante active, sauf mention contraire. */
const PRODUCTS: SeedProduct[] = [
  {
    slug: "sac-tote-canvas",
    name: "Sac tote en canvas",
    description: "Grand sac en toile pour le marché.",
    categorySlug: "accessoires",
    variants: [{ priceCents: 1500, active: true }],
    active: true,
    day: 1,
  },
  {
    slug: "coussin-brode",
    name: "Coussin brodé",
    description: "Un sac de rangement est offert avec ce coussin.",
    categorySlug: "accessoires",
    variants: [{ priceCents: 2400, active: true }],
    active: true,
    // Volontairement LE PLUS RÉCENT : sans le classement par pertinence, il
    // passerait devant le sac tote sur la recherche « sac ».
    day: 20,
  },
  {
    slug: "casquette-noire",
    name: "Casquette noire",
    description: "Casquette en coton épais.",
    categorySlug: "accessoires",
    variants: [
      // Variante la moins chère mais DÉSACTIVÉE : elle ne doit pas compter
      // dans le « à partir de » (sinon on affiche un prix qu'on ne peut pas
      // commander).
      { priceCents: 500, active: false },
      { priceCents: 2000, active: true },
    ],
    active: true,
    day: 3,
  },
  {
    slug: "bougie-parfumee",
    name: "Bougie parfumée",
    description: "Cire de soja, mèche en coton.",
    categorySlug: "accessoires",
    variants: [{ priceCents: 1200, active: true }],
    active: true,
    day: 4,
  },
  {
    slug: "chemise-en-lin",
    name: "Chemise en lin",
    description: "Lin lavé, coupe droite.",
    categorySlug: "vetements",
    variants: [{ priceCents: 4500, active: true }],
    active: true,
    day: 5,
  },
  {
    slug: "chino-beige",
    name: "Chino beige",
    description: "Chino en coton.",
    categorySlug: "vetements",
    variants: [{ priceCents: 3900, active: true }],
    active: true,
    day: 6,
  },
  {
    slug: "pull-en-laine",
    name: "Pull en laine",
    description: "Laine mérinos.",
    categorySlug: "vetements",
    variants: [{ priceCents: 5900, active: true }],
    active: true,
    day: 7,
  },
  {
    slug: "echarpe-cachemire",
    name: "Écharpe en cachemire",
    description: "Douce et chaude.",
    categorySlug: "vetements",
    variants: [{ priceCents: 3200, active: true }],
    active: true,
    day: 8,
  },
  {
    slug: "chaussettes-coton",
    name: "Chaussettes en coton",
    description: "Lot de trois paires.",
    categorySlug: "vetements",
    variants: [{ priceCents: 900, active: true }],
    active: true,
    day: 9,
  },
  {
    slug: "theiere-emaillee",
    name: "Théière émaillée",
    description: "Théière en fonte émaillée, 1 litre.",
    categorySlug: "maison",
    variants: [{ priceCents: 2900, active: true }],
    active: true,
    day: 10,
  },
  {
    slug: "vase-en-gres",
    name: "Vase en grès",
    description: "Grès émaillé, fait main.",
    categorySlug: "maison",
    variants: [{ priceCents: 3400, active: true }],
    active: true,
    day: 11,
  },
  {
    slug: "plaid-en-laine",
    name: "Plaid en laine",
    description: "Laine des Pyrénées.",
    categorySlug: "maison",
    variants: [{ priceCents: 6700, active: true }],
    active: true,
    day: 12,
  },
  {
    slug: "miroir-rond",
    name: "Miroir rond",
    description: "Cadre en chêne massif.",
    categorySlug: "maison",
    variants: [{ priceCents: 5200, active: true }],
    active: true,
    day: 13,
  },
  {
    slug: "lampe-de-chevet",
    name: "Lampe de chevet",
    description: "Abat-jour en lin.",
    categorySlug: "maison",
    variants: [{ priceCents: 4300, active: true }],
    active: true,
    day: 14,
  },
  {
    slug: "panier-tresse",
    name: "Panier tressé",
    description: "Osier tressé main.",
    categorySlug: "maison",
    variants: [{ priceCents: 2100, active: true }],
    active: true,
    day: 15,
  },
  {
    slug: "tabouret-en-bois",
    name: "Tabouret en bois",
    description: "Chêne massif.",
    categorySlug: "maison",
    variants: [{ priceCents: 8900, active: true }],
    active: true,
    day: 16,
  },
  {
    slug: "sans-variante",
    name: "Produit sans variante",
    description: "Produit publié mais aucune variante active pour l'instant.",
    categorySlug: "maison",
    variants: [],
    active: true,
    day: 17,
  },
  {
    slug: "ancien-produit-retire",
    name: "Ancien produit retiré",
    description: "Produit dépublié : il ne doit apparaître nulle part.",
    categorySlug: "vetements",
    variants: [{ priceCents: 100, active: true }],
    active: false,
    day: 18,
  },
];

/** Catégories créées dans le DÉSORDRE alphabétique pour prouver que l'ordre
 *  affiché vient bien de `position`. */
const CATEGORIES = [
  { slug: "vetements", name: "Vêtements", position: 2 },
  { slug: "maison", name: "Maison", position: 3 },
  { slug: "accessoires", name: "Accessoires", position: 1 },
];

async function seedCatalog(): Promise<void> {
  for (const category of CATEGORIES) {
    await prismaTest.category.create({ data: category });
  }

  for (const product of PRODUCTS) {
    const category = await prismaTest.category.findUniqueOrThrow({
      where: { slug: product.categorySlug },
    });
    const created = await prismaTest.product.create({
      data: {
        slug: product.slug,
        name: product.name,
        description: product.description,
        categoryId: category.id,
        active: product.active,
        createdAt: new Date(Date.UTC(2026, 0, product.day)),
      },
    });

    for (const variant of product.variants) {
      await prismaTest.variant.create({
        data: {
          sku: `${product.slug}-${variant.priceCents}`,
          name: product.name,
          priceCents: variant.priceCents,
          attributes: {},
          active: variant.active,
          productId: created.id,
        },
      });
    }
  }
}

const ids = (page: { items: Array<{ slug: string }> }) => page.items.map((item) => item.slug);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

describe("loadCatalog — recherche", () => {
  it("trouve un produit par son nom", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({ query: "tote", categorySlug: null, sort: "recents", page: 1 });
    expect(ids(view)).toEqual(["sac-tote-canvas"]);
    expect(view.total).toBe(1);
  });

  it("trouve un produit par sa description", async () => {
    await seedCatalog();
    // « offert » n'apparaît QUE dans la description du coussin.
    const { view } = await loadCatalog({ query: "offert", categorySlug: null, sort: "recents", page: 1 });
    expect(ids(view)).toEqual(["coussin-brode"]);
  });

  it("est insensible à la casse", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({ query: "TOTE", categorySlug: null, sort: "recents", page: 1 });
    expect(ids(view)).toEqual(["sac-tote-canvas"]);
  });

  it("est insensible aux accents", async () => {
    await seedCatalog();
    const sansAccent = await loadCatalog({
      query: "theiere emaillee",
      categorySlug: null,
      sort: "recents",
      page: 1,
    });
    expect(ids(sansAccent.view)).toEqual(["theiere-emaillee"]);

    const avecAccent = await loadCatalog({
      query: "Théière",
      categorySlug: null,
      sort: "recents",
      page: 1,
    });
    expect(ids(avecAccent.view)).toEqual(["theiere-emaillee"]);
  });

  it("classe un nom avant une description, même si la description est plus récente", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({ query: "sac", categorySlug: null, sort: "recents", page: 1 });
    expect(ids(view)).toEqual(["sac-tote-canvas", "coussin-brode"]);
  });

  it("rend tout le catalogue actif sur une requête vide, et rien de dépublié", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 1 });
    const activeCount = PRODUCTS.filter((p) => p.active).length;
    expect(view.total).toBe(activeCount);
    expect(ids(view)).not.toContain("ancien-produit-retire");
  });

  it("renvoie 0 résultat et une page vide quand rien ne correspond", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({
      query: "zzzzintrouvable",
      categorySlug: null,
      sort: "recents",
      page: 1,
    });
    // C'est exactement la condition de l'état vide affiché par la page.
    expect(view.total).toBe(0);
    expect(view.items).toEqual([]);
    expect(view.pageCount).toBe(1);
  });
});

describe("loadCatalog — tri par prix (« à partir de »)", () => {
  it("trie par prix croissant, variantes inactives exclues, sans-prix en dernier", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({
      query: "",
      categorySlug: null,
      sort: "prix-asc",
      page: 1,
      pageSize: 100,
    });

    expect(ids(view)).toEqual([
      "chaussettes-coton", // 900
      "bougie-parfumee", // 1200
      "sac-tote-canvas", // 1500
      "casquette-noire", // 2000 (et NON 500 : la variante 500 est inactive)
      "panier-tresse", // 2100
      "coussin-brode", // 2400
      "theiere-emaillee", // 2900
      "echarpe-cachemire", // 3200
      "vase-en-gres", // 3400
      "chino-beige", // 3900
      "lampe-de-chevet", // 4300
      "chemise-en-lin", // 4500
      "miroir-rond", // 5200
      "pull-en-laine", // 5900
      "plaid-en-laine", // 6700
      "tabouret-en-bois", // 8900
      "sans-variante", // aucun prix → fin de liste
    ]);

    const prices = view.items.map((item) => item.minPriceCents);
    expect(prices.slice(0, -1)).toEqual([900, 1200, 1500, 2000, 2100, 2400, 2900, 3200, 3400, 3900, 4300, 4500, 5200, 5900, 6700, 8900]);
    expect(prices.at(-1)).toBeNull();
  });

  it("trie par prix décroissant, sans-prix TOUJOURS en dernier", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({
      query: "",
      categorySlug: null,
      sort: "prix-desc",
      page: 1,
      pageSize: 100,
    });

    expect(view.items[0]?.slug).toBe("tabouret-en-bois");
    expect(view.items[0]?.minPriceCents).toBe(8900);
    expect(view.items[1]?.slug).toBe("plaid-en-laine");
    expect(view.items.at(-1)?.slug).toBe("sans-variante");
    expect(view.items.at(-1)?.minPriceCents).toBeNull();
  });

  it("trie par nouveauté et exclut les produits dépubliés", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 1 });
    expect(view.items[0]?.slug).toBe("coussin-brode");
    // Le produit dépublié est le 2e plus récent en base : il ne doit pas
    // apparaître du tout.
    expect(ids(view)).not.toContain("ancien-produit-retire");
  });
});

describe("loadCatalog — pagination", () => {
  it("rend 12 produits par page, puis une dernière page partielle, sans doublon", async () => {
    await seedCatalog();
    const page1 = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 1 });
    const page2 = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 2 });

    expect(page1.view.items).toHaveLength(12);
    expect(page1.view.total).toBe(17);
    expect(page1.view.pageCount).toBe(2);
    expect(page1.view.hasNext).toBe(true);
    expect(page1.view.firstIndex).toBe(1);
    expect(page1.view.lastIndex).toBe(12);

    // 17 produits → la page 2 en contient 5 (dernière page partielle).
    expect(page2.view.items).toHaveLength(5);
    expect(page2.view.hasNext).toBe(false);
    expect(page2.view.hasPrev).toBe(true);
    expect(page2.view.lastIndex).toBe(17);

    const idsPage1 = new Set(ids(page1.view));
    expect(ids(page2.view).some((slug) => idsPage1.has(slug))).toBe(false);
  });

  it("ramène une page hors bornes sur la dernière page", async () => {
    await seedCatalog();
    const { view } = await loadCatalog({ query: "", categorySlug: null, sort: "recents", page: 99 });
    expect(view.page).toBe(2);
    expect(view.items).toHaveLength(5);
  });
});

describe("catégories", () => {
  it("ordonne les catégories par `position`, pas par ordre alphabétique", async () => {
    await seedCatalog();
    const nav = await loadCategoryNav();
    expect(nav.map((category) => category.slug)).toEqual(["accessoires", "vetements", "maison"]);
    expect(nav.map((category) => category.name)).toEqual(["Accessoires", "Vêtements", "Maison"]);
    // Comptes de produits ACTIFS uniquement.
    expect(nav.find((c) => c.slug === "accessoires")?.productCount).toBe(4);
    expect(nav.find((c) => c.slug === "vetements")?.productCount).toBe(5);
  });

  it("ne rend QUE les produits de la catégorie demandée", async () => {
    await seedCatalog();
    const result = await loadCategoryPage("accessoires", {
      query: "",
      sort: "recents",
      page: 1,
      pageSize: 100,
    });
    expect(result).not.toBeNull();
    expect(result?.category.name).toBe("Accessoires");
    expect(result?.view.items.every((item) => item.categorySlug === "accessoires")).toBe(true);
    expect(result?.view.total).toBe(4);
    expect(ids(result?.view ?? { items: [] })).not.toContain("chemise-en-lin");
  });

  it("renvoie null pour un slug inconnu (la page en fait un 404)", async () => {
    await seedCatalog();
    expect(await findCategoryBySlug("categorie-inexistante")).toBeNull();
    expect(
      await loadCategoryPage("categorie-inexistante", { query: "", sort: "recents", page: 1 }),
    ).toBeNull();
  });

  it("cherche dans la catégorie ET respecte le tri prix", async () => {
    await seedCatalog();
    const result = await loadCategoryPage("accessoires", {
      query: "sac",
      sort: "prix-asc",
      page: 1,
    });
    expect(ids(result?.view ?? { items: [] })).toEqual(["sac-tote-canvas", "coussin-brode"]);
  });
});

describe("pages (Next) — contrat de navigation", () => {
  it("la page catégorie lève un 404 (notFound) pour un slug inconnu", async () => {
    await seedCatalog();
    // `notFound()` de Next lève une erreur porteuse du digest NEXT_NOT_FOUND :
    // c'est le mécanisme réel qui produit le 404 côté HTTP.
    await expect(
      CategoryPage({ params: { slug: "categorie-inexistante" }, searchParams: {} }),
    ).rejects.toThrowError(/NEXT_NOT_FOUND/);
  });

  it("la page catégorie rend la catégorie connue sans lever", async () => {
    await seedCatalog();
    const element = await CategoryPage({ params: { slug: "accessoires" }, searchParams: {} });
    expect(element).toBeTruthy();
  });

  it("redirige l'ancienne URL /products?category=<slug> vers /categorie/<slug>", async () => {
    await seedCatalog();
    // `redirect()` de Next jette une erreur dont le `message` vaut exactement
    // « NEXT_REDIRECT » : l'URL de destination est portée par une propriété
    // distincte (`digest`), pas concaténée au message. Tester le message seul
    // échoue donc toujours, même quand la redirection est correcte. On
    // capture l'erreur et on inspecte les deux champs.
    let caught: unknown;
    try {
      await ProductsListPage({ searchParams: { category: "vetements" } });
    } catch (e) {
      caught = e;
    }
    expect(caught, "la page doit rediriger les anciennes URL").toBeDefined();
    const err = caught as { message?: string; digest?: string };
    const trace = `${err.message ?? ""} ${err.digest ?? ""} ${String(caught)}`;
    expect(err.message).toBe("NEXT_REDIRECT");
    expect(trace).toContain("/categorie/vetements");
  });
});

describe("borne de chargement", () => {
  it("signale un catalogue tronqué au-delà de la borne de scan", async () => {
    const category = await prismaTest.category.create({
      data: { slug: "enorme", name: "Énorme", position: 1 },
    });
    // 301 produits sans variante : un seul INSERT, on teste la borne, pas la
    // performance d'écriture.
    await prismaTest.product.createMany({
      data: Array.from({ length: 301 }, (_, index) => ({
        slug: `produit-${String(index).padStart(3, "0")}`,
        name: `Produit ${index}`,
        description: "Produit de test.",
        categoryId: category.id,
        active: true,
      })),
    });

    const { view, scanTruncated } = await loadCatalog({
      query: "",
      categorySlug: null,
      sort: "recents",
      page: 1,
    });

    // Le drapeau remonte jusqu'à la page, qui l'annonce à l'utilisateur au
    // lieu de laisser croire à un catalogue parcouru en entier.
    expect(scanTruncated).toBe(true);
    expect(view.total).toBe(300);
  });
});
