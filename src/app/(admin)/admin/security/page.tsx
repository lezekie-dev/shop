import Link from "next/link";
import { redirect } from "next/navigation";

import { getTwoFactorStatus } from "@/server/admin-2fa";
import { requireCapability } from "@/server/guards";
import { IconShield } from "@/ui/components/icons";
import { TotpDisable } from "@/ui/components/admin/totp-disable";
import { TotpEnrollment } from "@/ui/components/admin/totp-enrollment";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

/**
 * Sécurité du compte CONNECTÉ : double authentification TOTP.
 *
 * Accessible à tout compte interne (capacité `auth:login`) : chacun gère son
 * propre facteur. Aucune route n'accepte d'identifiant d'utilisateur en
 * paramètre — l'identité vient de la session, donc un compte ne peut pas
 * enrôler ou désactiver la 2FA d'un autre (IDOR).
 *
 * Un compte sans 2FA voit l'état « inactive » et le chemin d'activation ; la
 * connexion n'est jamais bloquée par l'absence de 2FA.
 */
export default async function AdminSecurityPage() {
  const user = await requireCapability("auth:login");
  const status = await getTwoFactorStatus(user.id);
  if (!status) {
    // Compte supprimé entre la garde et cette lecture : on ne rend rien.
    redirect("/admin/login");
  }

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Sécurité</h1>
          <p className="admin-page__sub">
            Compte {user.email} · rôle {user.role} · double authentification{" "}
            {status.enabled ? "active" : "inactive"}.
          </p>
        </div>
        <Link href="/admin" className="btn btn-secondary">
          Retour au tableau de bord
        </Link>
      </div>

      <section className="card enter enter-2">
        <div className="admin-section__head">
          <h2 className="card__title">
            <IconShield className="admin-nav__icon" aria-hidden /> Double authentification (TOTP)
          </h2>
          {status.enabled ? (
            <span className="badge badge-pending">Active</span>
          ) : status.pending ? (
            <span className="badge badge-neutral">Enrôlement en cours</span>
          ) : (
            <span className="badge badge-cancelled">Inactive</span>
          )}
        </div>

        {status.enabled ? (
          <div className="admin-stack">
            <p style={{ margin: 0 }}>
              Activée le <strong>{status.enabledAt ? formatDateTime(status.enabledAt) : "—"}</strong>.
              À chaque connexion, un code à 6 chiffres est demandé après le mot de passe ; il change
              toutes les 30 secondes et un code déjà utilisé est refusé.
            </p>

            <details>
              <summary>Code de secours</summary>
              <p className="form-field__hint">
                À conserver hors de l&apos;appareil. Il permet de se connecter et de désactiver la
                2FA si le téléphone est perdu. Il n&apos;est pas à usage unique : traitez-le comme
                un second mot de passe.
              </p>
              <p className="kv__value kv__value--num" style={{ margin: 0 }}>
                <code className="steps-list__code">{status.recoveryCode ?? "—"}</code>
              </p>
            </details>

            <TotpDisable />
          </div>
        ) : (
          <TotpEnrollment
            pending={
              status.pending && status.pendingSecret && status.pendingOtpAuthUri
                ? {
                    secret: status.pendingSecret,
                    otpAuthUri: status.pendingOtpAuthUri,
                    recoveryCode: status.recoveryCode ?? "",
                    issuer: status.issuer,
                  }
                : null
            }
          />
        )}
      </section>

      <section className="card enter enter-3">
        <h2 className="card__title">Ce que cette protection garantit</h2>
        <ul className="alert-list">
          <li className="alert-row">
            <span className="alert-row__name">Tolérance d&apos;horloge ±30 s</span>
            <span className="alert-row__meta">
              Le code courant, celui du pas précédent et celui du pas suivant sont acceptés : un
              téléphone légèrement décalé ne vous enferme pas dehors.
            </span>
          </li>
          <li className="alert-row">
            <span className="alert-row__name">Rejeu refusé</span>
            <span className="alert-row__meta">
              Un code déjà utilisé pour une connexion réussie n&apos;est plus accepté pendant sa
              durée de validité : il faut attendre le code suivant (moins de 30 secondes).
            </span>
          </li>
          <li className="alert-row">
            <span className="alert-row__name">Tentatives de code plafonnées</span>
            <span className="alert-row__meta">
              Un code faux est compté comme un échec de connexion et bloque le compte après
              5 essais sur 15 minutes : deviner 6 chiffres en force brute n&apos;est pas rentable.
            </span>
          </li>
          <li className="alert-row">
            <span className="alert-row__name">Droits relus à chaque requête</span>
            <span className="alert-row__meta">
              Un changement de rôle ou la désactivation d&apos;un compte prend effet immédiatement,
              sans attendre l&apos;expiration du cookie de session.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
