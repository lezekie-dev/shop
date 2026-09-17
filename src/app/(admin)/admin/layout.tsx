import type { ReactNode } from "react";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { AdminNav } from "@/ui/components/admin/admin-nav";
import { LogoutButton } from "@/ui/components/admin/logout-button";

import "@/ui/styles/admin.css";

/**
 * Coquille du back-office : en-tête (boutique + admin connecté + déconnexion),
 * navigation latérale sur desktop / barre scrollable sur mobile, contenu à droite.
 *
 * Ce layout ne redirige PAS : `/admin/login` vit sous le même segment et doit
 * rester accessible. L'authentification est exigée par chaque page via
 * `requireAdmin()`, et le middleware couvre les navigations `/admin/*`.
 * Sans session, on rend simplement une coquille nue (cas de /admin/login).
 */

const SHOP_NAME = process.env.SHOP_NAME ?? "Shop";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

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
          <div className="admin-header__meta">
            <span className="admin-header__identity">
              <span className="sr-only">Connecté en tant que </span>
              <span className="admin-header__email">{user.email}</span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="admin-layout">
        <AdminNav />
        <div className="admin-main">{children}</div>
      </div>
    </div>
  );
}
