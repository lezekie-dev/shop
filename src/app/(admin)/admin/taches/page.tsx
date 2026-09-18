import Link from "next/link";

import { formatJobDuration, jobLabel } from "@/domain/jobs";
import { RECENT_JOB_RUNS_LIMIT, listRecentJobRuns } from "@/server/admin-jobs";
import { requireCapability } from "@/server/guards";
import { DataTable } from "@/ui/components/admin/data-table";
import { JobStatusBadge } from "@/ui/components/admin/job-status-badge";
import { formatDateTime } from "@/ui/format";
import { IconCheck, IconTasks } from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * Journal des tâches planifiées (`/admin/taches`).
 *
 * POURQUOI CETTE PAGE
 * Les jobs tournent sans personne devant l'écran. Sans cette page, la seule
 * façon de savoir qu'une sauvegarde échoue depuis trois nuits était de se
 * connecter en SSH et de lire un fichier de log — ce que personne ne fait.
 * Une panne invisible n'est pas une panne détectée (AC J1).
 *
 * Elle affiche les 20 dernières exécutions (nom, date, statut, durée, message
 * d'erreur) et le compteur d'échecs sur la fenêtre affichée. Aucune action :
 * c'est une page de LECTURE, ouverte aux deux rôles internes (capacité
 * `jobs:read`), parce que l'opérateur qui expédie les commandes est la
 * première personne concernée par un job cassé.
 */
export default async function AdminJobsPage() {
  // Lecture seule : la capacité `jobs:read` est portée par ADMIN et STAFF
  // (CONVENTIONS §13). Aucun `role === "ADMIN"` ici.
  await requireCapability("jobs:read");

  const runs = await listRecentJobRuns(RECENT_JOB_RUNS_LIMIT);
  const failedCount = runs.filter((run) => run.status === "FAILED").length;
  const runningCount = runs.filter((run) => run.status === "RUNNING").length;

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <p className="eyebrow">Exploitation</p>
          <h1 className="admin-page__title">Tâches planifiées</h1>
          <p className="admin-page__sub">
            Les {RECENT_JOB_RUNS_LIMIT} dernières exécutions, de la plus récente à la plus
            ancienne. Un job en échec doit être vu ici, jamais découvert par un client mécontent.
          </p>
        </div>
        <Link href="/admin" className="btn btn-secondary">
          Tableau de bord
        </Link>
      </div>

      {/* Bandeau de synthèse : le nombre d'échecs est ce qu'on cherche des yeux
          en arrivant sur la page, avant de lire ligne par ligne. */}
      <p className="admin-muted enter enter-2" role="status">
        {runs.length === 0
          ? "Aucune exécution enregistrée pour le moment."
          : `${runs.length} exécution${runs.length > 1 ? "s" : ""} affichée${
              runs.length > 1 ? "s" : ""
            } · ${failedCount} en échec · ${runningCount} en cours.`}
      </p>

      <div className="enter enter-3">
        <DataTable
          caption="Les dernières exécutions de tâches planifiées, de la plus récente à la plus ancienne"
          rows={runs}
          getRowKey={(row) => row.id}
          // Les lignes en échec sont mises en avant : la couleur ne fait que
          // renforcer le badge et le message, elle ne porte jamais l'info seule.
          rowClassName={(row) => (row.status === "FAILED" ? "data-table__row--alert" : undefined)}
          emptyState={
            <div className="empty-state">
              <IconTasks className="empty-state__icon" />
              <p className="empty-state__title">Aucune tâche exécutée</p>
              <p className="empty-state__text">
                Les tâches (réconciliation des paiements, sauvegarde de la base) écrivent une
                ligne ici à chaque exécution. Une page vide signifie qu&apos;aucune n&apos;a
                encore tourné — vérifiez que les crons système sont bien installés.
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
              key: "startedAt",
              header: "Démarrée",
              nowrap: true,
              render: (row) => <span className="num">{formatDateTime(row.startedAt)}</span>,
            },
            {
              key: "name",
              header: "Tâche",
              render: (row) => (
                <span>
                  {jobLabel(row.name)}
                  <br />
                  <span className="admin-muted num">{row.name}</span>
                </span>
              ),
            },
            {
              key: "status",
              header: "Statut",
              render: (row) => <JobStatusBadge status={row.status} />,
            },
            {
              key: "duration",
              header: "Durée",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="num">
                  {formatJobDuration(row.durationMs)}
                  {row.status === "RUNNING" ? (
                    <span className="admin-muted"> (en cours)</span>
                  ) : null}
                </span>
              ),
            },
            {
              key: "error",
              header: "Message",
              render: (row) =>
                row.status === "FAILED" ? (
                  // Le message d'erreur est affiché EN ENTIER : le tronquer
                  // obligerait à rouvrir un terminal, ce que cette page existe
                  // pour éviter. `title` donne la version complète au survol
                  // pour les messages tronqués visuellement par la largeur.
                  <span className="admin-muted" title={row.error ?? undefined}>
                    {row.error ?? "Échec sans message — voir les logs du serveur."}
                  </span>
                ) : row.status === "RUNNING" ? (
                  <span className="admin-muted">En cours d&apos;exécution…</span>
                ) : (
                  <span className="admin-muted" aria-hidden>
                    <IconCheck className="admin-inline-icon" /> Terminée sans erreur
                  </span>
                ),
            },
          ]}
        />
      </div>
    </div>
  );
}
