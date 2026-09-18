import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Newsreader, Inter, JetBrains_Mono } from "next/font/google";

import "@/ui/styles/tokens.css";
import "@/ui/styles/shell.css";

import { SiteHeader } from "@/ui/components/site-header";
import { SiteFooter } from "@/ui/components/site-footer";
import { loadHeaderCategories } from "@/server/catalog";

/*
 * Polices chargées via next/font : Next les télécharge au build et les sert
 * depuis le domaine de l'app (aucune requête vers Google au runtime, aucun
 * décalage de texte sur réseau 3G).
 *
 * Chaque police écrit SA variable de token sur <body> :
 *   --font-display → Newsreader (titrage éditorial)
 *   --font-body    → Inter      (corps de texte)
 *   --font-numeric → JetBrains Mono (montants et identifiants)
 *
 * tokens.css reste la seule source des valeurs de repli (Georgia, system-ui) :
 * si une police ne se charge pas, la pile de secours s'applique inchangée.
 */

/**
 * Newsreader — APPLIQUÉE « à la lettre » depuis la maquette Stitch.
 *
 * Le remplacement de Fraunces par Newsreader n'est pas un détail : les
 * MAQUETTES HTML (celles dont les captures ont servi de référence) chargent
 * explicitement `Newsreader` — le fichier de tokens joint disait Fraunces,
 * mais c'est le HTML qui fait foi puisqu'il a produit le rendu validé.
 *
 * Newsreader est un serif éditorial de presse, avec un axe optique (`opsz`)
 * qui durcit les contrastes sur les grandes tailles. C'est ce qui donne au
 * titrage son air de une de magazine, là où Fraunces penchait vers
 * l'affiche. On garde l'axe `opsz` auto.
 */
const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  style: ["normal", "italic"],
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

/**
 * JetBrains Mono — réservée aux MONTANTS et identifiants, comme la maquette
 * le prescrit. Une police à chasse fixe aligne les colonnes de chiffres : sur
 * un récapitulatif de commande, les centimes tombent les uns sous les autres
 * au lieu de flotter.
 */
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-numeric",
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
      <body className={`${newsreader.variable} ${inter.variable} ${jetbrains.variable}`}>
        <SiteHeader categories={categories} />
        <main className="site-main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
