import { describe, expect, it } from "vitest";

import { compactAfterRemoval, positionsFor, reorderIds } from "@/domain/product-images";

/**
 * Ordonnancement des visuels.
 *
 * La contrainte `@@unique([productId, position])` interdit à deux visuels de
 * partager un rang. Tous les cas sont donc énumérés ici, sans base : un test
 * d'intégration ne peut en couvrir que deux ou trois, et c'est précisément le
 * cas oublié (le premier, le dernier, le produit à un seul visuel) qui casse
 * en production.
 */

const THREE = ["a", "b", "c"];

describe("reorderIds", () => {
  it("monte un visuel d'un rang", () => {
    expect(reorderIds(THREE, "b", "up")).toEqual(["b", "a", "c"]);
    expect(reorderIds(THREE, "c", "up")).toEqual(["a", "c", "b"]);
  });

  it("descend un visuel d'un rang", () => {
    expect(reorderIds(THREE, "a", "down")).toEqual(["b", "a", "c"]);
    expect(reorderIds(THREE, "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("ne fait rien quand le déplacement est impossible (bords de liste)", () => {
    // Monter le premier ou descendre le dernier n'est pas une erreur : c'est
    // un non-événement. Lever une erreur obligerait l'UI à connaître les
    // bornes, et ferait échouer un double-clic.
    expect(reorderIds(THREE, "a", "up")).toEqual(THREE);
    expect(reorderIds(THREE, "c", "down")).toEqual(THREE);
  });

  it("déplace un visuel en tête avec « cover »", () => {
    expect(reorderIds(THREE, "c", "cover")).toEqual(["c", "a", "b"]);
    expect(reorderIds(THREE, "b", "cover")).toEqual(["b", "a", "c"]);
  });

  it("ne fait rien si le visuel est déjà la photo principale", () => {
    expect(reorderIds(THREE, "a", "cover")).toEqual(THREE);
  });

  it("gère un produit à un seul visuel (aucun déplacement possible)", () => {
    expect(reorderIds(["seul"], "seul", "up")).toEqual(["seul"]);
    expect(reorderIds(["seul"], "seul", "down")).toEqual(["seul"]);
    expect(reorderIds(["seul"], "seul", "cover")).toEqual(["seul"]);
  });

  it("ignore un identifiant inconnu plutôt que de produire un ordre absurde", () => {
    expect(reorderIds(THREE, "inexistant", "up")).toEqual(THREE);
  });

  it("ne modifie pas le tableau reçu", () => {
    const source = [...THREE];
    reorderIds(source, "b", "up");
    expect(source).toEqual(THREE);
  });

  it("produit TOUJOURS une permutation complète — donc des rangs uniques", () => {
    // C'est la propriété qui compte pour la contrainte d'unicité : après
    // n'importe quel déplacement, l'ensemble des identifiants est identique,
    // et les rangs sont exactement 0..n-1.
    const ids = ["a", "b", "c", "d", "e", "f"];
    for (const id of ids) {
      for (const move of ["up", "down", "cover"] as const) {
        const result = reorderIds(ids, id, move);
        expect([...result].sort()).toEqual([...ids].sort());
        expect(new Set(result).size).toBe(result.length);
      }
    }
  });
});

describe("compactAfterRemoval", () => {
  it("recollé les rangs après suppression (pas de trou dans l'ordre d'affichage)", () => {
    expect(compactAfterRemoval(THREE, "b")).toEqual(["a", "c"]);
    expect(compactAfterRemoval(THREE, "a")).toEqual(["b", "c"]);
    expect(compactAfterRemoval(THREE, "inexistant")).toEqual(THREE);
    expect(compactAfterRemoval(["seul"], "seul")).toEqual([]);
  });
});

describe("positionsFor", () => {
  it("produit des rangs compacts à partir de zéro", () => {
    expect(positionsFor(0)).toEqual([]);
    expect(positionsFor(3)).toEqual([0, 1, 2]);
  });
});
