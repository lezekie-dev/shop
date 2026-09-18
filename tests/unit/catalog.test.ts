import { describe, expect, it } from "vitest";

import {
  buildCatalogHref,
  buildCatalogView,
  CATALOG_PAGE_SIZE,
  catalogPageLinks,
  foldText,
  matchRank,
  normalizeQuery,
  paginateItems,
  parseCatalogSort,
  parsePageNumber,
  sortCatalogItems,
  tokenizeQuery,
  type CatalogListItem,
} from "@/domain/catalog";

/**
 * Tests unitaires de la logique de catalogue (recherche, tri, pagination).
 *
 * Ils portent sur les FONCTIONS PURES : pas de base, pas de navigateur, pas de
 * mock. C'est délibéré — un test E2E qui compte « 12 cartes » ne vérifie jamais
 * l'ORDRE des cartes, or c'est exactement ce qui casse un tri (le premier
 * défaut d'un tri par prix est de renvoyer les bons produits dans le mauvais
 * ordre).
 */

/** Un produit de test : une ligne de base, des dérogations explicites. */
function item(
  id: string,
  name: string,
  options: { description?: string; createdAt?: Date; price?: number | null } = {},
): CatalogListItem {
  return {
    id,
    slug: id,
    name,
    description: options.description ?? "",
    createdAt: options.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    // `undefined` = prix par défaut, `null` = explicitement sans variante.
    minPriceCents: options.price === undefined ? 1000 : options.price,
  };
}

const NEWER = new Date("2026-06-01T00:00:00.000Z");
const OLDER = new Date("2025-01-01T00:00:00.000Z");

describe("normalizeQuery / parsePageNumber / parseCatalogSort", () => {
  it("réduit les espaces et borne la longueur de la requête", () => {
    expect(normalizeQuery("  sac   tote  ")).toBe("sac tote");
    expect(normalizeQuery("sac\u00a0tote")).toBe("sac tote");
    expect(normalizeQuery("x".repeat(200))).toHaveLength(80);
  });

  it("accepte un tableau de paramètres (arrivée par ?q=a&q=b)", () => {
    expect(normalizeQuery(["sac", "tote"])).toBe("sac");
  });

  it("convertit une requête absente ou non textuelle en chaîne vide", () => {
    expect(normalizeQuery(undefined)).toBe("");
    expect(normalizeQuery("")).toBe("");
  });

  it("ramène toute page invalide à la page 1", () => {
    expect(parsePageNumber("3")).toBe(3);
    expect(parsePageNumber(undefined)).toBe(1);
    expect(parsePageNumber("0")).toBe(1);
    expect(parsePageNumber("-2")).toBe(1);
    expect(parsePageNumber("abc")).toBe(1);
  });

  it("retombe sur « nouveautés » pour un tri inconnu ou absent", () => {
    expect(parseCatalogSort("prix-asc")).toBe("prix-asc");
    expect(parseCatalogSort("prix-desc")).toBe("prix-desc");
    expect(parseCatalogSort("recents")).toBe("recents");
    expect(parseCatalogSort("nimportequoi")).toBe("recents");
    expect(parseCatalogSort(undefined)).toBe("recents");
  });
});

describe("foldText / tokenizeQuery / matchRank", () => {
  it("replie casse, accents, ligatures et apostrophes typographiques", () => {
    expect(foldText("Théière ÉMAILLÉE")).toBe("theiere emaillee");
    expect(foldText("Cœur d’été")).toBe("coeur d'ete");
    expect(foldText("  Sac   Tote ")).toBe("sac tote");
  });

  it("découpe la requête en mots", () => {
    expect(tokenizeQuery("t-shirt blanc")).toEqual(["t", "shirt", "blanc"]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });

  it("classe un mot du NOM avant un mot de la DESCRIPTION", () => {
    const nom = { name: "Sac tote", description: "" };
    const description = { name: "Coussin", description: "Un sac est offert." };
    expect(matchRank(nom, "sac")).toBe(0);
    expect(matchRank(description, "sac")).toBe(1);
  });

  it("exige TOUS les mots (et non l'un ou l'autre)", () => {
    const produit = { name: "Sac tote en canvas", description: "" };
    expect(matchRank(produit, "sac canvas")).toBe(0);
    expect(matchRank(produit, "sac cuir")).toBeNull();
  });

  it("ne correspond à rien si la requête est vide", () => {
    expect(matchRank({ name: "Sac", description: "" }, "   ")).toBeNull();
  });
});

describe("sortCatalogItems — tri par prix", () => {
  const catalogue = [
    item("cher", "Cher", { price: 8900 }),
    item("pas-cher", "Pas cher", { price: 1200 }),
    item("moyen", "Moyen", { price: 4500 }),
  ];

  it("trie par prix croissant (ordre réel, pas seulement le nombre)", () => {
    expect(sortCatalogItems(catalogue, "prix-asc").map((i) => i.id)).toEqual([
      "pas-cher",
      "moyen",
      "cher",
    ]);
    expect(sortCatalogItems(catalogue, "prix-asc").map((i) => i.minPriceCents)).toEqual([
      1200, 4500, 8900,
    ]);
  });

  it("trie par prix décroissant", () => {
    expect(sortCatalogItems(catalogue, "prix-desc").map((i) => i.id)).toEqual([
      "cher",
      "moyen",
      "pas-cher",
    ]);
  });

  it("place un produit SANS variante en fin de liste, dans les deux sens", () => {
    const avecTrou = [
      item("cher", "Cher", { price: 8900 }),
      item("sans-variante", "Sans variante", { price: null }),
      item("pas-cher", "Pas cher", { price: 1200 }),
    ];
    // Le produit sans prix ne doit jamais ouvrir la page : « Prix indisponible »
    // en première position est la pire entrée possible sur un catalogue.
    expect(sortCatalogItems(avecTrou, "prix-asc").map((i) => i.id)).toEqual([
      "pas-cher",
      "cher",
      "sans-variante",
    ]);
    expect(sortCatalogItems(avecTrou, "prix-desc").map((i) => i.id)).toEqual([
      "cher",
      "pas-cher",
      "sans-variante",
    ]);
  });

  it("ne plante pas sur une liste vide ou entièrement sans prix", () => {
    expect(sortCatalogItems([], "prix-asc")).toEqual([]);
    const sansPrix = [item("a", "A", { price: null }), item("b", "B", { price: null })];
    expect(sortCatalogItems(sansPrix, "prix-desc").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("départage à prix égal par le nom (ordre déterministe)", () => {
    const memePrix = [
      item("z", "Zèbre", { price: 2000 }),
      item("a", "Anorak", { price: 2000 }),
      item("e", "Écharpe", { price: 2000 }),
    ];
    // « Écharpe » doit se ranger entre A et Z : le départage se fait sur le nom
    // replié, pas sur le code du caractère accentué.
    expect(sortCatalogItems(memePrix, "prix-asc").map((i) => i.id)).toEqual(["a", "e", "z"]);
  });
});

describe("sortCatalogItems — tri par nouveauté", () => {
  it("trie du plus récent au plus ancien", () => {
    const items = [
      item("vieux", "Vieux", { createdAt: OLDER }),
      item("recent", "Récent", { createdAt: NEWER }),
    ];
    expect(sortCatalogItems(items, "recents").map((i) => i.id)).toEqual(["recent", "vieux"]);
  });

  it("remonte les correspondances de NOM avant celles de DESCRIPTION", () => {
    const items = [
      // Plus récent, mais « sac » n'est QUE dans sa description.
      item("coussin", "Coussin brodé", {
        description: "Un sac de rangement est offert.",
        createdAt: NEWER,
      }),
      // Plus ancien, mais « sac » est dans son nom.
      item("tote", "Sac tote", { createdAt: OLDER }),
    ];
    const relevance = new Map([
      ["coussin", 1],
      ["tote", 0],
    ]);
    expect(sortCatalogItems(items, "recents", relevance).map((i) => i.id)).toEqual([
      "tote",
      "coussin",
    ]);
  });
});

describe("recherche (buildCatalogView)", () => {
  const catalogue = [
    item("tote", "Sac tote en canvas", { description: "Toile épaisse." }),
    item("theiere", "Théière émaillée", { description: "Fonte, 1 litre." }),
    item("coussin", "Coussin brodé", {
      description: "Un sac de rangement est offert.",
      createdAt: NEWER,
    }),
  ];
  const view = (query: string, sort: "recents" | "prix-asc" | "prix-desc" = "recents") =>
    buildCatalogView({ items: catalogue, query, sort, page: 1 });

  it("trouve un produit par son NOM", () => {
    expect(view("tote").items.map((i) => i.id)).toEqual(["tote"]);
  });

  it("trouve un produit par sa DESCRIPTION", () => {
    expect(view("fonte").items.map((i) => i.id)).toEqual(["theiere"]);
  });

  it("ignore la casse", () => {
    expect(view("TOTE").items.map((i) => i.id)).toEqual(["tote"]);
    expect(view("ToTe").items.map((i) => i.id)).toEqual(["tote"]);
  });

  it("ignore les accents, dans les deux sens", () => {
    // Le client tape sans accents ; la fiche produit en a (et inversement).
    expect(view("theiere").items.map((i) => i.id)).toEqual(["theiere"]);
    expect(view("émaillée").items.map((i) => i.id)).toEqual(["theiere"]);
  });

  it("met les correspondances de nom AVANT celles de description", () => {
    // « coussin » est plus récent : sans la pertinence, il passerait devant.
    expect(view("sac").items.map((i) => i.id)).toEqual(["tote", "coussin"]);
  });

  it("renvoie TOUT le catalogue quand la requête est vide", () => {
    const tout = view("");
    expect(tout.total).toBe(3);
    expect(tout.items).toHaveLength(3);
    expect(tout.query).toBe("");
  });

  it("renvoie une page vide (et un total à 0) quand rien ne correspond", () => {
    const vide = view("zzzzz");
    expect(vide.total).toBe(0);
    expect(vide.items).toEqual([]);
    // C'est la condition exacte que la page teste pour afficher l'état vide.
    expect(vide.pageCount).toBe(1);
  });

  it("garde le prix comme critère principal quand le tri prix est demandé", () => {
    // « coussin » (2400) n'est pas pertinent pour « sac », mais il est moins
    // cher que « tote » (1000 ? non : 1000 par défaut) — ici on vérifie que le
    // tri prix n'est pas écrasé par la pertinence.
    const items = [
      item("cher-pertinent", "Sac cher", { price: 9000 }),
      item("pas-cher", "Coussin", { description: "Un sac est offert.", price: 500 }),
    ];
    const trie = buildCatalogView({ items, query: "sac", sort: "prix-asc", page: 1 });
    expect(trie.items.map((i) => i.id)).toEqual(["pas-cher", "cher-pertinent"]);
  });
});

describe("pagination", () => {
  const catalogue = Array.from({ length: 25 }, (_, index) =>
    item(`p${String(index + 1).padStart(2, "0")}`, `Produit ${index + 1}`, {
      price: 1000 + index * 100,
    }),
  );

  it("affiche 12 produits par page", () => {
    expect(CATALOG_PAGE_SIZE).toBe(12);
    const page1 = paginateItems(catalogue, 1);
    expect(page1.items).toHaveLength(12);
    expect(page1.total).toBe(25);
    expect(page1.pageCount).toBe(3);
    expect(page1.hasNext).toBe(true);
    expect(page1.hasPrev).toBe(false);
    expect(page1.firstIndex).toBe(1);
    expect(page1.lastIndex).toBe(12);
  });

  it("renvoie des produits DIFFÉRENTS à la page suivante", () => {
    const page1 = paginateItems(catalogue, 1);
    const page2 = paginateItems(catalogue, 2);
    expect(page2.items).toHaveLength(12);
    const ids1 = new Set(page1.items.map((i) => i.id));
    const ids2 = page2.items.map((i) => i.id);
    expect(ids2.some((id) => ids1.has(id))).toBe(false);
    expect(page2.items[0]?.id).toBe("p13");
    expect(page2.firstIndex).toBe(13);
    expect(page2.lastIndex).toBe(24);
    expect(page2.hasPrev).toBe(true);
    expect(page2.hasNext).toBe(true);
  });

  it("rend une dernière page PARTIELLE", () => {
    const page3 = paginateItems(catalogue, 3);
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0]?.id).toBe("p25");
    expect(page3.hasNext).toBe(false);
    expect(page3.lastIndex).toBe(25);
  });

  it("ramène une page hors bornes dans les bornes", () => {
    const trop = paginateItems(catalogue, 99);
    expect(trop.page).toBe(3);
    expect(trop.items).toHaveLength(1);
  });

  it("pagine APRÈS avoir trié (le tri s'applique au catalogue entier)", () => {
    const view = buildCatalogView({ items: catalogue, query: "", sort: "prix-desc", page: 1 });
    const prices = view.items.map((i) => i.minPriceCents ?? 0);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    expect(prices[0]).toBe(3400); // 1000 + 24*100 : le plus cher du catalogue
    expect(view.total).toBe(25);
  });
});

describe("catalogPageLinks", () => {
  it("liste toutes les pages quand il y en a peu", () => {
    expect(catalogPageLinks(2, 3)).toEqual([1, 2, 3]);
  });

  it("garde la première, la dernière et une fenêtre autour de la page courante", () => {
    expect(catalogPageLinks(5, 10)).toEqual([1, "gap", 3, 4, 5, 6, 7, "gap", 10]);
  });

  it("ne pose pas de trou pour deux pages consécutives", () => {
    expect(catalogPageLinks(1, 5)).toEqual([1, 2, 3, "gap", 5]);
  });
});

describe("buildCatalogHref", () => {
  it("n'écrit que les paramètres utiles", () => {
    expect(buildCatalogHref("/products", {})).toBe("/products");
    expect(buildCatalogHref("/products", { query: "", sort: "recents", page: 1 })).toBe("/products");
    // Le tri par défaut et la page 1 ne s'écrivent pas : sinon les liens
    // canoniques traînent des paramètres inutiles et la pagination semble
    // ne pas avancer.
    expect(buildCatalogHref("/products", { sort: "prix-asc", page: 1 })).toBe(
      "/products?tri=prix-asc",
    );
    expect(buildCatalogHref("/categorie/vetements", { query: "sac", page: 2 })).toBe(
      "/categorie/vetements?q=sac&page=2",
    );
  });
});
