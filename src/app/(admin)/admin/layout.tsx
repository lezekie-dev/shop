import type { ReactNode } from "react";
import Link from "next/link";

import { roleLabel } from "@/domain/access";
import { findStaffUser } from "@/server/guards";
import { AdminNav } from "@/ui/components/admin/admin-nav";
import { visibleNavItems } from "@/ui/components/admin/admin-nav-items";
import { LogoutButton } from "@/ui/components/admin/logout-button";

import "@/ui/styles/admin.css";

/**
 * Coquille du back-office : en-tête (boutique + admin connecté + rôle +
 * déconnexion), navigation latérale sur desktop / barre scrollable sur mobile,
 * contenu à droite.
 *
 * Ce layout ne redirige PAS : `/admin/login` vit sous le même segment et doit
 * rester accessible. L'authentification est exigée par chaque page via une
 * garde (`requireStaff` / `requireCapability`), et le middleware couvre les
 * navigations `/admin/*`. Sans session (ou compte désactivé), on rend
 * simplement une coquille nue (cas de /admin/login).
 *
 * L'utilisateur est lu via `findStaffUser()` et non `getCurrentUser()` : la
 * garde revérifie `active` en base, donc un compte désactivé perd son en-tête,
 * son menu et ses liens dès la requête suivante — pas à l'expiration du cookie.
 *
 * Le menu est calculé ici (côté serveur) à partir du rôle : un STAFF ne reçoit
 * même pas dans son HTML les liens Produits/Stock/Utilisateurs. Ce n'est qu'un
 * confort — l'autorisation réelle est revérifiée par les gardes de chaque page
 * et de chaque API.
 */
const SHOP_NAME = process.env.SHOP_NAME ?? "Shop";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await findStaffUser();

  if (!user) {
    return <div className="admin-shell">{children}</div>;
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header__inner">
          <Link href="/admin" className="admin-brand">
            {SHOP_NAME}
            <span className="sr-only"> — tableau de bord</span>
          </Link>
          {/* Marqueur de démonstration. Il vit dans le BACK-OFFICE, pas sur la
              vitrine : le client final n'a pas à lire une note technique, mais
              le marchand doit savoir que les visuels et le paiement sont
              simulés tant qu'il n'a pas branché ses propres moyens. */}
          <span className="admin-env-badge" title="Visuels et paiement de démonstration — à remplacer avant mise en production">
            Démo
          </span>
          <div className="admin-header__meta">
            <span className="admin-header__identity">
              <span className="sr-only">Connecté en tant que </span>
              <span className="admin-header__email">{user.email}</span>
              {/* Le rôle est affiché : un opérateur doit comprendre pourquoi des
                  entrées de menu lui manquent, sans aller lire la doc. */}
              <span
                className="badge badge-neutral"
                title={
                  user.role === "STAFF"
                    ? "Accès opérateur : commandes et expéditions, sans catalogue ni gestion des utilisateurs"
                    : "Accès complet, y compris catalogue, utilisateurs et paramètres"
                }
              >
                {roleLabel(user.role)}
              </span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="admin-layout">
        <AdminNav items={visibleNavItems(user.role)} />
        <div className="admin-main">{children}</div>
      </div>
    </div>
  );
}
