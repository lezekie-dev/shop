import Link from "next/link";

import { roleLabel } from "@/domain/access";
import { countActiveAdmins, getAdminUser, listAdminUsers } from "@/server/admin-users";
import { requireCapability } from "@/server/guards";
import { DataTable, RowChevron } from "@/ui/components/admin/data-table";
import { UserCreateForm } from "@/ui/components/admin/user-create-form";
import { UserEditForm } from "@/ui/components/admin/user-edit-form";
import { IconUsers } from "@/ui/components/icons";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

type SearchParams = { user?: string };

/**
 * Gestion des utilisateurs internes du back-office (capacité `users:read`,
 * réservée à ADMIN — cf. CONVENTIONS §13).
 *
 * POURQUOI LA GARDE EST ICI ET PAS SEULEMENT DANS LE MENU : un STAFF qui tape
 * l'URL à la main, ou qui rejoue une requête avec son cookie, doit être refusé.
 * `requireCapability()` redirige vers /admin/forbidden (page explicite) ; les
 * routes API `/api/admin/users*` renvoient 403 (cf. `requireApiCapability`).
 *
 * RÈGLE DU DERNIER ADMIN : `activeAdmins` est passé aux formulaires pour que
 * l'UI AVERTISSE avant l'action (« c'est le dernier administrateur actif ») et
 * désactive les contrôles concernés. Ce n'est qu'un confort : la règle est
 * appliquée en base, dans la transaction, par `updateAdminUser`.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireCapability("users:read");

  const [users, activeAdmins] = await Promise.all([listAdminUsers(), countActiveAdmins()]);
  const selectedId = typeof searchParams.user === "string" ? searchParams.user : null;
  const selected = selectedId ? await getAdminUser(selectedId) : null;

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Utilisateurs</h1>
          <p className="admin-page__sub">
            {users.length} compte{users.length > 1 ? "s" : ""} interne
            {users.length > 1 ? "s" : ""} · {activeAdmins} administrateur
            {activeAdmins > 1 ? "s" : ""} actif{activeAdmins > 1 ? "s" : ""}.
          </p>
        </div>
        <Link href="/admin/security" className="btn btn-secondary">
          Ma double authentification
        </Link>
      </div>

      <div className="notice enter enter-2">
        <p className="notice__title">Deux rôles, deux périmètres</p>
        <p style={{ margin: 0 }}>
          Un <strong>opérateur</strong> (STAFF) traite les commandes, les expéditions et les
          livraisons ; il ne voit ni le catalogue, ni les utilisateurs, ni les encaissements
          manuels et remboursements. Un <strong>administrateur</strong> (ADMIN) a accès à tout. Un
          compte n&apos;est jamais supprimé : on le désactive, ce qui ferme immédiatement ses
          sessions tout en conservant l&apos;historique de ses actions dans le journal d&apos;audit.
        </p>
      </div>

      <div className="enter enter-3">
        <DataTable
          caption="Utilisateurs internes du back-office, administrateurs d'abord"
          rows={users}
          getRowKey={(row) => row.id}
          rowHref={(row) => `/admin/users?user=${row.id}`}
          rowLabel={(row) => `Modifier le compte ${row.email}`}
          rowClassName={(row) => (row.active ? undefined : "data-table__row--muted")}
          emptyState={
            <div className="empty-state">
              <IconUsers className="empty-state__icon" />
              <p className="empty-state__title">Aucun utilisateur</p>
              <p className="empty-state__text">
                La table est vide : créez un premier administrateur ci-dessous. C&apos;est la seule
                situation où le back-office ne peut pas être administré.
              </p>
            </div>
          }
          columns={[
            {
              key: "identity",
              header: "Utilisateur",
              render: (row) => (
                <span>
                  <span className="num">{row.email}</span>
                  {row.name ? <span className="muted"> — {row.name}</span> : null}
                  {row.id === actor.id ? <span className="muted"> (vous)</span> : null}
                </span>
              ),
            },
            {
              key: "role",
              header: "Rôle",
              nowrap: true,
              render: (row) => (
                <span className="badge badge-neutral">{roleLabel(row.role)}</span>
              ),
            },
            {
              key: "status",
              header: "Statut",
              nowrap: true,
              render: (row) =>
                row.active ? (
                  <span className="badge badge-paid">Actif</span>
                ) : (
                  <span className="badge badge-cancelled">Désactivé</span>
                ),
            },
            {
              key: "totp",
              header: "Double authentification",
              nowrap: true,
              render: (row) =>
                row.totpEnabled ? (
                  // JAUNE et non vert : la 2FA active est une bonne nouvelle,
                  // mais elle se lit surtout comme une contrainte pour l'utilisateur.
                  <span className="badge badge-pending">Active</span>
                ) : row.totpPending ? (
                  <span className="badge badge-neutral">Enrôlement en cours</span>
                ) : (
                  <span className="badge badge-cancelled">Inactive</span>
                ),
            },
            {
              key: "lastLoginAt",
              header: "Dernière connexion",
              nowrap: true,
              render: (row) => (
                <span className="num">
                  {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "jamais"}
                </span>
              ),
            },
            {
              key: "action",
              header: "Action",
              align: "right",
              nowrap: true,
              render: (row) => (
                <Link href={`/admin/users?user=${row.id}`}>
                  Modifier <RowChevron />
                </Link>
              ),
            },
          ]}
        />
      </div>

      {selected ? (
        <section className="card enter enter-4">
          <div className="admin-section__head">
            <h2 className="card__title">Modifier {selected.email}</h2>
            <Link href="/admin/users">Fermer</Link>
          </div>
          <UserEditForm
            user={{
              id: selected.id,
              email: selected.email,
              name: selected.name,
              role: selected.role,
              active: selected.active,
              totpEnabled: selected.totpEnabled,
            }}
            activeAdmins={activeAdmins}
            isSelf={selected.id === actor.id}
          />
        </section>
      ) : null}

      <section className="card enter enter-4">
        <div className="admin-section__head">
          <h2 className="card__title">Créer un compte</h2>
        </div>
        <p className="form-field__hint" style={{ marginBottom: "var(--sp-4)" }}>
          Le mot de passe est haché (bcrypt) avant d&apos;être stocké et n&apos;apparaît jamais en
          clair, ni en base, ni dans le journal d&apos;audit. Son destinataire le change après sa
          première connexion.
        </p>
        <UserCreateForm />
      </section>
    </div>
  );
}
