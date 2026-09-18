"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { CustomerLogoutButton } from "@/ui/components/customer/customer-logout-button";

/**
 * Barre de navigation de l'espace client.
 *
 * Le bouton de déconnexion n'apparaît que si une session est ouverte : sur
 * /compte/connexion, proposer « Se déconnecter » n'aurait aucun sens.
 * L'état d'authentification est calculé côté serveur (layout) et passé en
 * prop — un composant client ne peut pas lire le cookie de session.
 */
export function AccountNav({
  isAuthenticated,
  displayName,
}: {
  isAuthenticated: boolean;
  displayName?: string | null;
}) {
  const pathname = usePathname() ?? "/compte";
  const isOrders = pathname === "/compte" || pathname.startsWith("/compte/commandes");
  const isAddresses = pathname.startsWith("/compte/adresses");

  const linkClass = (active: boolean) =>
    active ? "site-header__link site-header__link--active" : "site-header__link";

  return (
    <nav className="toolbar" aria-label="Espace client">
      <div className="actions">
        {isAuthenticated ? (
          <>
            <Link href="/compte" aria-current={isOrders ? "page" : undefined} className={linkClass(isOrders)}>
              Mes commandes
            </Link>
            <Link
              href="/compte/adresses"
              aria-current={isAddresses ? "page" : undefined}
              className={linkClass(isAddresses)}
            >
              Mon carnet d&apos;adresses
            </Link>
            {displayName && <span className="small muted">Connecté·e en tant que {displayName}</span>}
          </>
        ) : (
          <>
            <Link
              href="/compte/connexion"
              aria-current={pathname.startsWith("/compte/connexion") ? "page" : undefined}
              className={linkClass(pathname.startsWith("/compte/connexion"))}
            >
              Se connecter
            </Link>
            <Link
              href="/compte/inscription"
              aria-current={pathname.startsWith("/compte/inscription") ? "page" : undefined}
              className={linkClass(pathname.startsWith("/compte/inscription"))}
            >
              Créer un compte
            </Link>
          </>
        )}
      </div>
      {isAuthenticated && (
        <div className="actions">
          <CustomerLogoutButton />
        </div>
      )}
    </nav>
  );
}
