import type { JobStatus } from "@prisma/client";

/**
 * Logique pure des tâches planifiées (`JobRun`) — TypeScript pur, aucune
 * dépendance runtime (cf. CONVENTIONS §2) : tout ce fichier prend des
 * structures de données et rend des structures de données, ce qui permet de
 * tester les calculs de durée et la détection d'alerte SANS base de données.
 *
 * POURQUOI CE MODULE EXISTE
 * `JobRun` est écrit par des scripts externes (cron de sauvegarde,
 * réconciliation des paiements) et lu par le back-office. Les deux questions
 * qui comptent pour un marchand sont : « combien de temps a pris ce job ? »
 * et « est-ce que le même job échoue en boucle ? ». Ce sont des calculs, pas
 * des requêtes : ils vivent ici, testés unitairement, et `src/server/admin-jobs.ts`
 * ne fait que les nourrir avec les lignes lues en base.
 */

/** Statuts possibles d'une exécution (doublure du type Prisma, pour l'UI). */
export const JOB_STATUSES: readonly JobStatus[] = ["RUNNING", "SUCCEEDED", "FAILED"];

/** `true` si la chaîne est un statut connu — jamais de rendu sur une valeur brute. */
export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  RUNNING: "En cours",
  SUCCEEDED: "Réussie",
  FAILED: "En échec",
};

/** Libellé français d'un statut de tâche. */
export function jobStatusLabel(status: JobStatus): string {
  return JOB_STATUS_LABELS[status];
}

/**
 * Nombre de `FAILED` consécutifs à partir du DÉBUT du tableau fourni.
 * Le tableau doit être ordonné du plus récent au plus ancien (c'est l'ordre de
 * la page `/admin/taches`).
 *
 * Un statut `RUNNING` interrompt la série : tant que l'exécution en cours n'est
 * pas terminée, on ne sait pas si elle échouera. Déclencher une alerte sur une
 * série « peut-être interrompue » ferait crier le back-office pour rien, et une
 * alerte qui crie pour rien n'est plus lue.
 */
export function consecutiveFailures(statuses: readonly JobStatus[]): number {
  let count = 0;
  for (const status of statuses) {
    if (status !== "FAILED") break;
    count += 1;
  }
  return count;
}

/**
 * Seuil d'alerte du dashboard : 3 échecs consécutifs sur le MÊME job.
 * En dessous, c'est un incident isolé (réseau, fournisseur muet) qu'une
 * nouvelle exécution peut résoudre ; à partir de 3, c'est un job cassé.
 */
export const JOB_FAILURE_ALERT_THRESHOLD = 3;

/** Ce qu'une alerte doit permettre de faire : nommer le job ET lire la cause. */
export type JobFailureAlert = {
  name: string;
  /** Nombre d'échecs consécutifs les plus récents (>= seuil). */
  consecutiveFailures: number;
  /** Message de la dernière exécution en échec — null si non renseigné. */
  lastError: string | null;
  /** Date de départ de la dernière exécution. */
  lastStartedAt: Date;
};

/** Ligne minimale nécessaire à la détection d'alerte (cf. `JobRun`). */
export type JobRunSignal = {
  name: string;
  status: JobStatus;
  error: string | null;
  startedAt: Date;
};

/**
 * Repère les jobs dont les `threshold` dernières exécutions ont TOUTES échoué.
 *
 * Le regroupement se fait en mémoire à partir des exécutions récentes : c'est
 * volontairement simple. Un `GROUP BY` SQL avec fenêtre donnerait le même
 * résultat pour la table entière ; ici on ne regarde que la fenêtre affichée
 * (les 200 derniers `JobRun`), ce qui suffit — un job qui échoue 3 fois de
 * suite et qui n'apparaît pas dans les 200 dernières exécutions n'existe pas
 * dans ce projet à cette échelle.
 */
export function detectJobFailureAlerts(
  runs: readonly JobRunSignal[],
  threshold: number = JOB_FAILURE_ALERT_THRESHOLD,
): JobFailureAlert[] {
  const byJob = new Map<string, JobRunSignal[]>();
  for (const run of runs) {
    const list = byJob.get(run.name);
    if (list) list.push(run);
    else byJob.set(run.name, [run]);
  }

  const alerts: JobFailureAlert[] = [];
  for (const [name, jobRuns] of byJob) {
    const failures = consecutiveFailures(jobRuns.map((run) => run.status));
    if (failures < threshold) continue;
    const latest = jobRuns[0];
    // `jobRuns` est non vide par construction, mais noUncheckedIndexedAccess
    // nous oblige à le prouver — et le prouver coûte moins cher qu'un `!`.
    if (!latest) continue;
    alerts.push({
      name,
      consecutiveFailures: failures,
      lastError: latest.error,
      lastStartedAt: latest.startedAt,
    });
  }

  // Le job le plus cassé en tête, puis ordre alphabétique : l'ordre d'affichage
  // ne doit pas dépendre de l'ordre d'itération de la Map.
  return alerts.sort(
    (a, b) => b.consecutiveFailures - a.consecutiveFailures || a.name.localeCompare(b.name),
  );
}

/** Ce qu'il faut pour calculer une durée : le début, la fin éventuelle. */
export type JobRunTiming = {
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
};

/**
 * Durée d'exécution en millisecondes, ou `null` quand elle n'est pas
 * calculable honnêtement.
 *
 * - job terminé (`finishedAt` renseigné) → `finishedAt - startedAt` ;
 * - job `RUNNING` → temps écoulé depuis `startedAt` (la page affiche « depuis »),
 *   ce qui permet de repérer une tâche bloquée plutôt que de n'afficher rien ;
 * - tout autre cas (terminé sans `finishedAt`, donnée incomplète) → `null` :
 *   on n'invente pas une durée à partir d'une donnée manquante.
 *
 * `now` est reçu en paramètre et non lu ici : c'est la règle de `src/domain/`
 * (pas de `Date.now()`), et c'est ce qui rend ce calcul testable sans mock.
 */
export function jobDurationMs(run: JobRunTiming, now: Date): number | null {
  if (run.finishedAt) {
    return Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime());
  }
  if (run.status === "RUNNING") {
    return Math.max(0, now.getTime() - run.startedAt.getTime());
  }
  return null;
}

/**
 * Durée lisible par un humain. Le but est que Fatou puisse dire « ça a pris
 * deux minutes » sans convertir des millisecondes de tête.
 * Une durée inconnue s'affiche « — », jamais « 0 ms » (qui ferait croire à
 * une exécution instantanée).
 */
export function formatJobDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;

  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${(durationMs / 1_000).toFixed(1).replace(".", ",")} s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return `${totalMinutes} min ${`${seconds}`.padStart(2, "0")} s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${`${minutes}`.padStart(2, "0")} min`;
}

/**
 * Noms de jobs connus → libellé français.
 *
 * Le nom brut reste le repli : un job ajouté demain par un autre chantier doit
 * apparaître dans la page, même si personne n'a pensé à sa traduction. Une
 * ligne invisible parce qu'« inconnue » serait le contraire du but.
 */
const JOB_LABELS: Record<string, string> = {
  "reconcile-payments": "Réconciliation des paiements",
  "backup-db": "Sauvegarde de la base",
  "purge-carts": "Purge des paniers abandonnés",
};

/** Libellé d'affichage d'un job, ou son nom technique en repli. */
export function jobLabel(name: string): string {
  return JOB_LABELS[name] ?? name;
}
