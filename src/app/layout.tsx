import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter } from "next/font/google";

import "@/ui/styles/tokens.css";
import "@/ui/styles/shell.css";

import { SiteHeader } from "@/ui/components/site-header";
import { SiteFooter } from "@/ui/components/site-footer";
import { loadHeaderCategories } from "@/server/catalog";

/*
 * Les deux polices du design system sont chargées via next/font : Next les
 * télécharge au build et les sert depuis le domaine de l'app (aucune requête
 * vers Google au runtime, aucun décalage de texte sur réseau 3G).
 *
 * Chaque police écrit SA variable de token sur <body> :
 *   --font-display → Fraunces (titrage éditorial)
 *   --font-body    → Inter   (corps de texte)
 *
 * tokens.css reste la seule source des valeurs de repli (Georgia, system-ui) :
 * si une police ne se charge pas, la pile de secours s'applique inchangée.
 */

/**
 * Fraunces est une police variable à trois axes :
 *   - `opsz` (taille optique) : auto via `font-optical-sizing`
 *   - `wght` (graisse) : 100-900, on l'interpole librement
 *   - `SOFT` : adoucit les terminaisons — les valeurs hautes donnent une
 *     allure plus calligraphique, qu'on ne veut PAS (trop décoratif)
 *   - `WONK` : active des détails « excentriques » (jambages, italiques
 *     alternatives). On l'ACTIVE : c'est ce qui donne à Fraunces son
 *     caractère éditorial qui la distingue d'un serif neutre — sans lui,
 *     le titrage redevient quelconque, ce qui était exactement le reproche
 *     fait au design précédent.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Shop — vêtements et accessoires en toile et coton",
  description:
    "Une petite sélection de vêtements et d'accessoires en toile et coton. Commande sans compte, paiement Mobile Money ou virement, expédition suivie.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // La navigation par catégorie de l'en-tête vient de la base, dans l'ordre
  // d'affichage voulu par le marchand (`position`). Elle est chargée ICI, côté
  // serveur : passer par un `fetch` client ferait apparaître la barre de
  // navigation en second, ce qui est plus coûteux sur 3G qu'une requête
  // indexée sur une table de quelques lignes.
  //
  // `loadHeaderCategories` ne lève jamais : une panne de cette requête ne doit
  // pas empêcher l'affichage du site (ni l'accès à /admin/login, qui sert
  // justement à réparer la boutique).
  //
  // Compromis assumé : cette requête tourne aussi pour les pages /admin, où
  // l'en-tête public se cache. Coût : une requête sur une petite table. Le
  // supprimer demanderait de sortir l'en-tête du layout racine (toutes les
  // routes concernées) — hors périmètre de cette carte.
  const categories = await loadHeaderCategories();

  return (
    <html lang="fr">
      <body className={`${fraunces.variable} ${inter.variable}`}>
        <SiteHeader categories={categories} />
        <main className="site-main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
