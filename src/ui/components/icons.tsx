import type { SVGProps } from "react";

/**
 * Icônes de la boutique — SVG en ligne, aucune dépendance externe.
 *
 * Pourquoi pas des emojis : le rendu d'un emoji dépend de la police système
 * de l'appareil (Apple, Google, Windows dessinent le même caractère
 * différemment). Sur une page marchande, ce rendu imprévisible casse la
 * cohérence visuelle — et un emoji ne peut pas prendre la couleur d'accent.
 *
 * Toutes les icônes partagent la même grille (24×24), la même épaisseur de
 * trait (1.75) et les mêmes extrémités arrondies. Elles héritent de
 * `currentColor` : leur couleur est pilotée par le CSS, jamais par le SVG.
 *
 * `aria-hidden` est posé systématiquement : ces icônes accompagnent TOUJOURS
 * un texte qui porte le sens. Les annoncer une seconde fois au lecteur d'écran
 * serait redondant.
 */

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  width: 22,
  height: 22,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

/** Camion de livraison — expédition. */
export function IconTruck(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 7.5h11.5v9H2z" />
      <path d="M13.5 10.5H18l3.5 3v3h-8z" />
      <circle cx="6.5" cy="18" r="1.75" />
      <circle cx="17" cy="18" r="1.75" />
    </svg>
  );
}

/** Téléphone — paiement mobile. */
export function IconPhone(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 5.5h3" />
    </svg>
  );
}

/** Flèche circulaire — retour produit. */
export function IconReturn(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 9.5h11a5.5 5.5 0 0 1 0 11H8" />
      <path d="M7 5.5l-4 4 4 4" />
    </svg>
  );
}

/** Enveloppe — confirmation par email. */
export function IconMail(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

/** Cadenas — paiement sûr. */
export function IconLock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Bloc de texte — page d'information. */
export function IconInfo(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.75h.01" />
    </svg>
  );
}

/* ── Icônes du back-office ──
   Les glyphes Unicode qui servaient d'icônes (◈ ◐ ◧ ❐) dépendent de la
   police système : taille optique irrégulière, alignement vertical imprécis,
   et rendu différent selon l'appareil. Sur un back-office qu'on lit toute la
   journée, ces défauts fatiguent. Mêmes règles que les icônes publiques :
   grille 24×24, trait 1.75, couleur héritée. */

/** Tableau de bord — grille de cartes. */
export function IconDashboard(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

/** Commandes — liste de lignes. */
export function IconOrders(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5h16" />
      <path d="M4 12h16" />
      <path d="M4 18.5h10" />
    </svg>
  );
}

/** Produits — étiquette. */
export function IconProducts(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 10.5 12 2.5l8.5 8-8.5 8.5z" />
      <circle cx="12" cy="8.25" r="1.35" />
    </svg>
  );
}

/** Stock — caisses empilées. */
export function IconStock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 7.5 12 3.5l8.5 4-8.5 4z" />
      <path d="m3.5 12 8.5 4 8.5-4" />
      <path d="m3.5 16.25 8.5 4 8.5-4" />
    </svg>
  );
}

/** Emails — boîte de réception. */
export function IconEmails(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 5.5h18v13H3z" />
      <path d="m3 8.5 9 5.5 9-5.5" />
    </svg>
  );
}

/** Utilisateurs — deux bustes : comptes internes du back-office. */
export function IconUsers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9.5" cy="8" r="3.25" />
      <path d="M3.5 19.5c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2" />
      <path d="M16.2 5.4a3.25 3.25 0 0 1 0 5.2" />
      <path d="M17.6 14.6c1.9.6 2.9 2.3 2.9 4.9" />
    </svg>
  );
}

/** Bouclier — sécurité du compte, double authentification. */
export function IconShield(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.2 5 6.2v5.6c0 4 3 7.4 7 9 4-1.6 7-5 7-9V6.2z" />
      <path d="m9.2 12.1 2.1 2.1 3.6-3.9" />
    </svg>
  );
}

/** Clé — code de secours, secret d'enrôlement. */
export function IconKey(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12h9" />
      <path d="M18 12v3" />
      <path d="M15.2 12v2.2" />
    </svg>
  );
}

/* ── Icônes d'état vide ──
   Un état vide (panier vide, aucune commande, recherche sans résultat) portait
   un emoji. Ces écrans sont vus par le marchand autant que par le client :
   l'emoji y produisait le même défaut de rendu variable que partout ailleurs.
   Ils sont plus grands que les icônes de liste (48 px) car ils occupent seuls
   la zone centrale d'un bloc vide. */

/** Colis — aucun produit, aucune commande. */
export function IconBox(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 7.5 12 3.5l8.5 4-8.5 4z" />
      <path d="m3.5 12 8.5 4 8.5-4" />
      <path d="m3.5 16.25 8.5 4 8.5-4" />
    </svg>
  );
}

/** Panier — panier vide, tunnel interrompu. */
export function IconCart(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 7h12l-1.2 11.1a2 2 0 0 1-2 1.9H9.2a2 2 0 0 1-2-1.9L6 7Z" />
      <path d="M9.2 7V6a2.8 2.8 0 0 1 5.6 0v1" />
    </svg>
  );
}

/** Loupe — recherche sans résultat. */
export function IconSearch(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

/** Semis — catalogue vide, rien à afficher encore. */
export function IconSeed(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21v-7" />
      <path d="M12 14c0-3.9 3.1-7 7-7 0 3.9-3.1 7-7 7Z" />
      <path d="M12 16c0-2.8-2.2-5-5-5 0 2.8 2.2 5 5 5Z" />
    </svg>
  );
}

/** Encaissement — aucun mouvement d'argent sur la période. */
export function IconEuro(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.8 9.2a3.6 3.6 0 1 0 0 5.6" />
      <path d="M8.6 10.8h4.6" />
      <path d="M8.6 13.2h4.6" />
    </svg>
  );
}

/** Validation — une file d'attente vide, c'est une bonne nouvelle. */
export function IconCheck(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.6 2.6 5-5.4" />
    </svg>
  );
}
