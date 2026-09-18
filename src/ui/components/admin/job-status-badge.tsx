import type { JobStatus } from "@prisma/client";

import { jobStatusLabel } from "@/domain/jobs";

/**
 * Badge de statut d'une exécution de tâche.
 *
 * Même principe que les badges de commande : chaque statut porte trois signaux
 * INDÉPENDANTS — une classe de couleur, un symbole propre et un libellé
 * français. Retirer la couleur (daltonisme, impression noir et blanc, mode
 * contraste élevé) ne fait perdre aucune information. Un job en échec doit
 * rester visible même pour qui ne distingue pas le rouge du vert.
 */

type JobStatusMeta = {
  className: string;
  symbol: string;
};

const JOB_STATUS_META: Record<JobStatus, JobStatusMeta> = {
  // En cours : couleur d'attente, pas d'erreur — une tâche qui tourne est normale.
  RUNNING: { className: "badge badge-pending", symbol: "◌" },
  SUCCEEDED: { className: "badge badge-paid", symbol: "✓" },
  // Échec : rouge + croix + libellé, les trois à la fois.
  FAILED: { className: "badge badge-cancelled", symbol: "✕" },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const meta = JOB_STATUS_META[status];
  return (
    <span className={meta.className}>
      <span aria-hidden>{meta.symbol}</span>
      {jobStatusLabel(status)}
    </span>
  );
}
