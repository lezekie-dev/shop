import Link from "next/link";

import { IconLock } from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * Page d'accès refusé (403) du back-office.
 *
 * POURQUOI UNE PAGE ET PAS UNE REDIRECTION SILENCIEUSE : les gardes de page
 * (`requireRole`, `requireCapability`) envoient ici un utilisateur authentifié
 * qui n'a pas la capacité demandée. Le renvoyer vers le tableau de bord sans
 * explication lui ferait croire à un lien cassé, et il recommencerait — alors
 * qu'il doit comprendre que c'est son RÔLE qui ne donne pas ce droit.
 *
 * Le code HTTP reste 200 côté rendu (c'est une page de l'application) ; le
 * refus réel, lui, est structuré : les routes API de ces mêmes fonctionnalités
 * répondent 403 (cf. `requireApiCapability`).
 */
export default function AdminForbiddenPage() {
  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Accès refusé</h1>
          <p className="admin-page__sub">
            Votre rôle ne donne pas accès à cette section du back-office.
          </p>
        </div>
        <Link href="/admin" className="btn btn-primary">
          Retour au tableau de bord
        </Link>
      </div>

      <section className="card enter enter-2">
        <div className="empty-state">
          <IconLock className="empty-state__icon" />
          <p className="empty-state__title">Droit insuffisant</p>
          <p className="empty-state__text">
            Les comptes <strong>opérateur</strong> traitent les commandes, les expéditions et les
            livraisons. La gestion des utilisateurs, le catalogue et les opérations financières
            (encaissement manuel, remboursement) sont réservés aux comptes{" "}
            <strong>administrateur</strong>. Demandez à un administrateur de vous ouvrir l&apos;accès
            si vous en avez besoin.
          </p>
          <div className="empty-state__actions">
            <Link href="/admin/orders" className="btn btn-secondary">
              Voir les commandes
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
