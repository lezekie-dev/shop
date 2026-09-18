"use client";

import { usePathname } from "next/navigation";

/**
 * Pied de page public — masqué sur /admin/*, comme l'en-tête.
 *
 * Le back-office a son propre cadre : un footer marchand sous un tableau de
 * bord n'apporte rien et mange de la hauteur utile.
 */
export function SiteFooter() {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/admin")) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__col">
          <p className="site-footer__brand">Shop</p>
          <p className="site-footer__text">
            Une boutique de produits physiques, pensée d&apos;abord pour le téléphone.
          </p>
        </div>

        <div className="site-footer__col">
          <p className="site-footer__title">Paiement</p>
          <ul className="site-footer__list">
            <li>Mobile Money (Orange, MTN)</li>
            <li>Virement bancaire</li>
            <li>Carte bancaire — bientôt</li>
          </ul>
        </div>

        <div className="site-footer__col">
          <p className="site-footer__title">Livraison &amp; retours</p>
          <ul className="site-footer__list">
            <li>Expédition suivie</li>
            <li>Numéro de suivi envoyé par email</li>
            <li>Retour accepté sous 14 jours</li>
          </ul>
        </div>

        <div className="site-footer__col">
          <p className="site-footer__title">Aide</p>
          <ul className="site-footer__list">
            <li>Commande sans création de compte</li>
            <li>Suivi depuis l&apos;email de confirmation</li>
          </ul>
        </div>
      </div>

      <div className="site-footer__legal">
        <p>
          © {year} Shop — démonstration technique. Mentions légales et conditions de
          vente à compléter avant mise en production.
        </p>
      </div>
    </footer>
  );
}
