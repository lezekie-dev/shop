import Link from "next/link";

import { staffCan, requireCapability } from "@/server/guards";
import {
  MANUAL_REVIEW_ATTEMPTS,
  PENDING_PAYMENTS_LIMIT,
  countStalePendingPayments,
  listPendingPayments,
} from "@/server/admin-payments";
import { DataTable } from "@/ui/components/admin/data-table";
import { PaymentActions } from "@/ui/components/admin/payment-actions";
import { PaymentMethodBadge } from "@/ui/components/admin/payment-method-badge";
import { Money } from "@/ui/components/money";
import { IconOrders } from "@/ui/components/icons";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

/**
 * Âge d'un paiement, en heures. L'unité est imposée par le KPI K9 (« paiements
 * bloqués > 24 h ») : parler en jours arrondirait un paiement de 25 h à « 1 j »
 * et masquerait précisément le dépassement qu'on cherche à voir.
 */
function formatAgeHours(hours: number): string {
  return `${hours} h`;
}

/**
 * Paiements bloqués en attente — la liste des commandes que Fatou ne doit PAS
 * expédier (user story I1).
 *
 * ACCESSIBLE EN LECTURE À STAFF : `orders:read` est la capacité qui couvre déjà
 * la liste des commandes et la boîte d'envoi des emails, et cette page ne
 * montre rien de plus (mêmes clients, mêmes montants, même numéro de commande).
 * Les ACTIONS, elles, dépendent de la matrice : relancer une vérification suit
 * `orders:read` (c'est ce que la tâche planifiée fait seule toutes les heures),
 * confirmer un encaissement exige `orders:transition:paid` (ADMIN). Aucun
 * `if (role === "ADMIN")` ici — la décision vient de `src/domain/access.ts` via
 * `staffCan`.
 *
 * La page ne décide RIEN : elle affiche un état et propose deux gestes. Un
 * paiement au bout des tentatives reste en tête de liste avec la mention « à
 * traiter manuellement » — aucune annulation, aucune libération de stock
 * (décision D6).
 */
export default async function AdminPaymentsPage() {
  // Capacité lue depuis la matrice §13, jamais un rôle en dur.
  const user = await requireCapability("orders:read");

  // Une seule horloge pour toute la page : sans ça, l'âge d'une ligne et le
  // compteur d'en-tête pourraient être calculés à deux instants différents et se
  // contredire au passage d'une heure.
  const now = new Date();

  const [{ rows, total }, staleCount] = await Promise.all([
    listPendingPayments({ now }),
    countStalePendingPayments({ now }),
  ]);

  const canConfirmReceipt = staffCan(user, "orders:transition:paid");
  const manualCount = rows.filter((row) => row.needsManualReview).length;

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Paiements en attente</h1>
          <p className="admin-page__sub">
            {total} paiement{total > 1 ? "s" : ""} en attente chez le fournisseur · ces commandes
            ne doivent pas être expédiées avant confirmation.
            {total > rows.length
              ? ` Affichage des ${PENDING_PAYMENTS_LIMIT} plus anciens.`
              : ""}
          </p>
        </div>
        <Link href="/admin/orders" className="btn btn-secondary">
          Voir les commandes
        </Link>
      </div>

      {/*
        Compteur d'en-tête exigé par l'AC (KPI K9, cible 0). Un zéro est une
        bonne nouvelle qui doit se LIRE : un encart vide laisserait croire que
        rien n'est mesuré.
      */}
      <section className="card enter enter-2" aria-labelledby="compteur-paiements">
        <h2 className="card__title" id="compteur-paiements">
          PENDING &gt; 24 h : <strong>{staleCount}</strong>{" "}
          {staleCount > 0 ? (
            <span className="badge badge-cancelled">à surveiller</span>
          ) : (
            <span className="badge badge-paid">objectif tenu</span>
          )}
        </h2>
        <p className="admin-muted" style={{ margin: 0 }}>
          {staleCount === 0
            ? "Aucun paiement en attente depuis plus de 24 h — c'est l'état attendu."
            : `${staleCount} paiement(s) en attente depuis plus de 24 h : la réconciliation continue de les interroger, mais l'absence de réponse du fournisseur mérite un appel de votre côté.`}{" "}
          {manualCount > 0
            ? `${manualCount} paiement(s) ont épuisé les tentatives automatiques et sont marqués « à traiter manuellement ».`
            : ""}
        </p>
      </section>

      <div className="enter enter-3">
        <DataTable
          caption="Paiements en attente, du plus ancien au plus récent"
          rows={rows}
          getRowKey={(row) => row.paymentId}
          rowHref={(row) => `/admin/orders/${row.orderId}`}
          rowLabel={(row) => `Ouvrir la commande ${row.orderNumber}`}
          emptyState={
            <div className="empty-state">
              <IconOrders className="empty-state__icon" />
              <p className="empty-state__title">Aucun paiement en attente</p>
              <p className="empty-state__text">
                Tous les paiements sont confirmés ou soldés. C&apos;est l&apos;état attendu : rien
                à vérifier, aucune commande bloquée. La tâche de réconciliation trace chaque
                passage dans les tâches planifiées, même quand il n&apos;y a rien à faire.
              </p>
              <div className="empty-state__actions">
                <Link href="/admin/orders" className="btn btn-primary">
                  Voir les commandes
                </Link>
              </div>
            </div>
          }
          columns={[
            {
              key: "number",
              header: "Commande",
              nowrap: true,
              render: (row) => <span className="num">{row.orderNumber}</span>,
            },
            {
              key: "customer",
              header: "Client",
              render: (row) => <span>{row.customerName}</span>,
            },
            {
              key: "amount",
              header: "Montant",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="money">
                  <Money cents={row.amountCents} currency={row.currency} />
                </span>
              ),
            },
            {
              key: "provider",
              header: "Fournisseur",
              render: (row) => <PaymentMethodBadge provider={row.provider} />,
            },
            {
              key: "createdAt",
              header: "Créé le",
              nowrap: true,
              render: (row) => <span className="num">{formatDateTime(row.createdAt)}</span>,
            },
            {
              key: "age",
              header: "Âge",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span>
                  {formatAgeHours(row.ageHours)}
                  {row.needsManualReview ? (
                    <>
                      <br />
                      <span className="badge badge-cancelled">à traiter manuellement</span>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              key: "attempts",
              header: "Tentatives",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span
                  title={`Traitement manuel recommandé à partir de ${MANUAL_REVIEW_ATTEMPTS} tentatives`}
                >
                  {row.reconcileAttempts}
                </span>
              ),
            },
            {
              key: "lastCheckedAt",
              header: "Dernière vérif.",
              nowrap: true,
              render: (row) => (
                <span className="num">
                  {row.lastCheckedAt ? formatDateTime(row.lastCheckedAt) : "Jamais"}
                </span>
              ),
            },
            {
              key: "nextReconcileAt",
              header: "Prochaine vérif.",
              nowrap: true,
              render: (row) => (
                <span className="num">
                  {row.nextReconcileAt
                    ? formatDateTime(row.nextReconcileAt)
                    : "À la prochaine tâche"}
                </span>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              align: "right",
              render: (row) => (
                <PaymentActions
                  paymentId={row.paymentId}
                  orderId={row.orderId}
                  orderNumber={row.orderNumber}
                  orderStatus={row.orderStatus}
                  provider={row.provider}
                  canConfirmReceipt={canConfirmReceipt}
                />
              ),
            },
          ]}
        />
      </div>

      <p className="admin-muted enter enter-4">
        La réconciliation interroge le fournisseur d&apos;origine de chaque paiement avec un délai
        croissant (2 min, 4 min, 8 min… plafonné à 24 h). Aucun paiement n&apos;est annulé ni
        remboursé automatiquement : un paiement sans réponse reste en attente jusqu&apos;à votre
        décision.
      </p>
    </div>
  );
}
