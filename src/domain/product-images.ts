/**
 * Ordre d'affichage des visuels d'un produit — **TypeScript pur**.
 *
 * POURQUOI CE MODULE EXISTE À PART
 * Les positions sont contraintes en base : `@@unique([productId, position])`.
 * Deux visuels d'un même produit ne peuvent donc JAMAIS occuper le même rang,
 * même pendant une fraction de seconde. Toute réorganisation est donc un
 * problème d'ordonnancement, pas un simple `update` — et c'est exactement le
 * genre de logique qu'on veut tester sans base de données, sans transaction et
 * sans mock, pour pouvoir énumérer tous les cas (premier, dernier, milieu,
 * produit à un seul visuel).
 *
 * RÈGLE DE SÉCURITÉ APPLIQUÉE PAR L'APPELANT : on réécrit TOUJOURS la liste
 * complète des positions (0..n-1) dans la même transaction, en deux passes :
 * d'abord des rangs temporaires négatifs (uniques entre eux car indexés), puis
 * les rangs définitifs. Aucune passe intermédiaire ne peut donc produire de
 * collision — pas même un échange « en place » qui se marcherait sur les pieds.
 */

/** Déplacement demandé sur un visuel. */
export type ImageMove = "up" | "down" | "cover";

/** Positions compactées : 0, 1, 2… sans trou. */
export function positionsFor(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * Nouvel ordre après un déplacement. Renvoie un NOUVEAU tableau ; l'ordre
 * d'entrée n'est pas modifié. Un déplacement impossible (monter le premier,
 * descendre le dernier, choisir comme principale celui qui l'est déjà) renvoie
 * l'ordre inchangé : c'est un non-événement, pas une erreur.
 */
export function reorderIds(
  ids: readonly string[],
  imageId: string,
  move: ImageMove,
): string[] {
  const order = [...ids];
  const from = order.indexOf(imageId);
  if (from === -1) return order;

  switch (move) {
    case "up": {
      if (from === 0) return order;
      [order[from - 1], order[from]] = [order[from]!, order[from - 1]!];
      return order;
    }
    case "down": {
      if (from === order.length - 1) return order;
      [order[from], order[from + 1]] = [order[from + 1]!, order[from]!];
      return order;
    }
    case "cover": {
      if (from === 0) return order;
      const [moved] = order.splice(from, 1);
      order.unshift(moved!);
      return order;
    }
  }
}

/**
 * Ordre après retrait d'un visuel : les rangs restants sont recollés (pas de
 * trou). L'AC l'exige — un trou dans l'ordre d'affichage ferait apparaître la
 * 3ᵉ photo avant la 2ᵉ dans une grille triée sur `position`.
 */
export function compactAfterRemoval(ids: readonly string[], imageId: string): string[] {
  return ids.filter((id) => id !== imageId);
}
