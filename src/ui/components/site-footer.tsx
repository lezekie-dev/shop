"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconLock, IconMail, IconReturn, IconTruck } from "@/ui/components/icons";

/**
 * Pied de page public — masqué sur /admin/*, comme l'en-tête.
 *
 * Le back-office a son propre cadre : un footer marchand sous un tableau de
 * bord n'apporte rien et mange de la hauteur utile.
 *
 * Ce que le footer ne dit PAS : les moyens de paiement indisponibles. Une
 * ligne « Carte bancaire — bientôt » annonce à l'acheteur ce qu'il ne peut pas
 * faire ; pour lui, c'est une raison de reporter l'achat. On liste donc
 * uniquement ce qui marche aujourd'hui.
 */
export function SiteFooter() {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/admin")) return null;

  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__col site-footer__col--brand">
          <p className="site-footer__brand">Shop</p>
          <p className="site-footer__text">
            Une petite sélection de vêtements et d&apos;accessoires en toile et coton,
            expédiée depuis notre atelier.
          </p>
        </div>

        <div className="site-footer__col">
          <p className="site-footer__title">Paiement</p>
          <ul className="site-footer__list site-footer__list--icons">
            <li>
              <IconLock />
              <span>Mobile Money (Orange, MTN)</span>
            </li>
            <li>
              <IconLock />
              <span>Virement bancaire</span>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <p className="site-footer__title">Livraison &amp; retours</p>
          <ul className="site-footer__list site-footer__list--icons">
            <li>
              <IconTruck />
              <span>Expédition suivie</span>
            </li>
            <li>
              <IconReturn />
              <span>Retour accepté sous 14 jours</span>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <p className="site-footer__title">Aide</p>
          <ul className="site-footer__list site-footer__list--icons">
            <li>
              <IconMail />
              <span>
                Suivi depuis l&apos;email de confirmation
              </span>
            </li>
            <li>
              <IconMail />
              <span>
                Une question ?{" "}
                <Link href="/products" className="site-footer__link">
                  Parcourir la boutique
                </Link>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer__legal">
        <p>© {year} Shop — vêtements et accessoires en toile et coton.</p>
      </div>
    </footer>
  );
}
