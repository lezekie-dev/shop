import type { ReactNode } from "react";

/**
 * Conteneur du parcours client.
 *
 * Le <main> racine ne plafonne plus la largeur (le back-office a besoin de
 * plus de place pour ses tableaux). C'est donc ici, dans le groupe de routes
 * boutique, que le plafond de lecture est posé — il ne s'applique qu'aux
 * pages client, jamais à /admin.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <div className="shop-container">{children}</div>;
}
