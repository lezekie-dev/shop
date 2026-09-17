import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter } from "next/font/google";

import "@/ui/styles/tokens.css";
import "@/ui/styles/shell.css";

import { SiteHeader } from "@/ui/components/site-header";

/*
 * Les deux polices du design system sont chargées via next/font : Next les
 * télécharge au build et les sert depuis le domaine de l'app (aucune requête
 * vers Google au runtime, aucun FOUT sur réseau 3G).
 *
 * Chaque police écrit SA variable de token sur <body> :
 *   --font-display → Fraunces (titrage éditorial)
 *   --font-body    → Inter   (corps de texte)
 * tokens.css reste la seule source des valeurs de repli (Georgia, system-ui) :
 * si une police ne se charge pas, la pile de secours s'applique inchangée.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Shop",
  description: "Boutique en ligne — catalogue de produits physiques",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${fraunces.variable} ${inter.variable}`}>
        <SiteHeader />
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
