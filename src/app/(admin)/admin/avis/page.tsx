import Link from "next/link";
import type { ReviewStatus } from "@prisma/client";

import {
  formatAgeInDays,
  formatRating,
  isModerationOverdue,
  MODERATION_OVERDUE_DAYS,
  reviewAgeInDays,
  toDisplayText,
} from "@/domain/review";
import { requireCapability, staffCan } from "@/server/guards";
import { countPendingReviews, listModerationQueue } from "@/server/reviews";
import { DataTable } from "@/ui/components/admin/data-table";
import { ReviewModerationActions } from "@/ui/components/admin/review-moderation";
import { IconCheck, IconInfo } from "@/ui/components/icons";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

/**
 * File de modération des avis (`/admin/avis`, F3).
 *
 * POURQUOI CETTE PAGE AFFICHE L'ANCIENNETÉ EN ÉVIDENCE
 * Le PO a fixé un critère chiffré : « 0 avis `PENDING` de plus de 7 jours »
 * (KPI K8). Une file de modération ne se vide pas parce qu'elle existe, mais
 * parce que le retard se voit : le compteur d'avis en retard est en tête de
 * page, et chaque ligne ancienne est marquée. Sans cela, la file « invisible »
 * redevient ce qu'elle était avant — une pile oubliée (R5).
 *
 * La file est triée du PLUS ANCIEN au plus récent (voir `listModerationQueue`) :
 * on modère d'abord ce qui attend depuis le plus longtemps, pas la dernière
 * arrivée.
 *
 * CAPACITÉS : `reviews:read` pour la page, `reviews:moderate` pour les actions.
 * Les deux sont portées par ADMIN et STAFF, mais les actions sont filtrées sur
 * la capacité réelle de l'utilisateur : pas de bouton qui renvoie 403.
 */

const STATUS_FILTERS: readonly ReviewStatus[] = ["PENDING", "APPROVED", "REJECTED"];

const STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: "En attente",
  APPROVED: "Publiés",
  REJECTED: "Rejetés",
};

const STATUS_BADGES: Record<ReviewStatus, string> = {
  PENDING: "badge badge-pending",
  APPROVED: "badge badge-paid",
  REJECTED: "badge badge-cancelled",
};

function parseStatus(value: string | undefined): ReviewStatus {
  return STATUS_FILTERS.includes(value as ReviewStatus) ? (value as ReviewStatus) : "PENDING";
}

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams?: { statut?: string; page?: string };
}) {
  // Aucun `role === "ADMIN"` : la capacité décide (CONVENTIONS §13).
  const user = await requireCapability("reviews:read");

  const status = parseStatus(searchParams?.statut);
  const queue = await listModerationQueue({ status, page: parsePage(searchParams?.page) });
  const counters = await countPendingReviews();
  // `now` calculé une fois : toutes les lignes de la page sont jugées sur la
  // MÊME horloge, sinon deux lignes peuvent diverger d'un jour entre le haut et
  // le bas du tableau.
  const now = new Date();
  const canModerate = staffCan(user, "reviews:moderate");

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <p className="eyebrow">Vitrine</p>
          <h1 className="admin-page__title">Avis clients</h1>
          <p className="admin-page__sub">
            Rien n&apos;est publié avant approbation. Un avis non modéré est un avis invisible sur
            la fiche produit, mais c&apos;est aussi un client qui attend une réponse.
          </p>
        </div>
        <Link href="/admin" className="btn btn-secondary">
          Tableau de bord
        </Link>
      </div>

      {/* Le compteur est l'information la plus importante de la page : c'est
          lui qui dit s'il y a un travail en retard (K8). */}
      <p className="admin-muted enter enter-2" role="status" aria-live="polite">
        {counters.pending === 0 ? (
          <>
            <IconCheck className="admin-inline-icon" /> Aucun avis en attente — la file est vide.
          </>
        ) : (
          <>
            <strong>
              {counters.pending} avis en attente{counters.pending > 1 ? "s" : ""}
            </strong>
            {counters.overdue > 0 ? (
              <span className="review-counter--overdue">
                {" "}
                · dont <strong>{counters.overdue}</strong> depuis plus de {MODERATION_OVERDUE_DAYS}{" "}
                jours (objectif : 0)
              </span>
            ) : (
              <> · aucun au-delà de {MODERATION_OVERDUE_DAYS} jours (objectif tenu).</>
            )}
          </>
        )}
      </p>

      <nav className="admin-filters enter enter-2" aria-label="Filtrer les avis par statut">
        {STATUS_FILTERS.map((value) => (
          <Link
            key={value}
            href={`/admin/avis?statut=${value}`}
            className={value === status ? "admin-filter admin-filter--active" : "admin-filter"}
            aria-current={value === status ? "page" : undefined}
          >
            {STATUS_LABELS[value]}
          </Link>
        ))}
      </nav>

      <div className="enter enter-3">
        <DataTable
          caption="Avis filtrés par statut, les plus anciens en tête"
          rows={queue.rows}
          getRowKey={(row) => row.id}
          // Ligne mise en avant au-delà du seuil K8 : la couleur RENFORCE
          // l'information « 9 jours », elle ne la porte pas seule.
          rowClassName={(row) =>
            row.status === "PENDING" && isModerationOverdue(row.createdAt, now)
              ? "data-table__row--alert"
              : undefined
          }
          emptyState={
            <div className="empty-state">
              <IconCheck className="empty-state__icon" />
              <p className="empty-state__title">
                {status === "PENDING" ? "Aucun avis à modérer" : "Aucun avis dans ce filtre"}
              </p>
              <p className="empty-state__text">
                {status === "PENDING"
                  ? "Tous les avis reçus ont été traités. C'est l'état attendu : un avis non modéré est un client qui attend, et un avis publié sans relecture est un risque de réputation."
                  : "Aucun avis ne porte ce statut pour le moment."}
              </p>
              <div className="empty-state__actions">
                <Link href="/admin" className="btn btn-secondary">
                  Retour au tableau de bord
                </Link>
              </div>
            </div>
          }
          columns={[
            {
              key: "age",
              header: "Attente",
              nowrap: true,
              render: (row) => {
                // L'ancienneté vient du domaine (`reviewAgeInDays`), comme le
                // seuil : une arithmétique recopiée ici finirait par diverger
                // de celle des compteurs et des tests.
                const days = reviewAgeInDays(row.createdAt, now);
                const overdue = row.status === "PENDING" && isModerationOverdue(row.createdAt, now);
                return (
                  <span className={overdue ? "review-age review-age--overdue" : "review-age"}>
                    <span className="num">{formatAgeInDays(days)}</span>
                    {overdue ? <span className="review-age__flag">à traiter</span> : null}
                    <br />
                    <span className="admin-muted">{formatDateTime(row.createdAt)}</span>
                  </span>
                );
              },
            },
            {
              key: "review",
              header: "Avis",
              render: (row) => (
                <>
                  <span className="review-stars" title={`${row.rating} sur 5`}>
                    <span aria-hidden>{"★".repeat(row.rating)}</span>
                    <span className="sr-only">Note : {row.rating} sur 5</span>
                  </span>{" "}
                  <span className="num">{formatRating(row.rating)}/5</span>
                  <br />
                  {row.title ? <strong>{toDisplayText(row.title)}</strong> : null}
                  {/* Texte affiché EN ENTIER : tronquer obligerait à ouvrir une
                      console pour modérer, ce que cette page existe pour éviter. */}
                  <p className="review__body review__body--admin">{toDisplayText(row.body)}</p>
                  <span className={STATUS_BADGES[row.status]}>{STATUS_LABELS[row.status]}</span>
                </>
              ),
            },
            {
              key: "product",
              header: "Produit",
              render: (row) => (
                <>
                  <Link href={`/products/${row.product.slug}`}>{row.product.name}</Link>
                  <br />
                  <span className="admin-muted num">Commande {row.orderNumber ?? "—"}</span>
                </>
              ),
            },
            {
              key: "author",
              header: "Client",
              render: (row) => (
                <>
                  {row.authorName}
                  <br />
                  <span className="admin-muted">{row.customerEmail ?? "client anonyme"}</span>
                </>
              ),
            },
            {
              key: "actions",
              header: "Décision",
              render: (row) =>
                row.status === "PENDING" ? (
                  canModerate ? (
                    <ReviewModerationActions reviewId={row.id} productName={row.product.name} />
                  ) : (
                    <span className="admin-muted">
                      <IconInfo className="admin-inline-icon" /> Lecture seule
                    </span>
                  )
                ) : (
                  <span className="admin-muted">
                    {row.moderatedAt
                      ? `Modéré le ${formatDateTime(row.moderatedAt)}`
                      : "Décision non horodatée"}
                  </span>
                ),
            },
          ]}
        />
      </div>
    </div>
  );
}
