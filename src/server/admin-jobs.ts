/**
 * Lecture des exécutions de tâches planifiées pour le back-office.
 *
 * ─── POURQUOI CETTE PAGE EXISTE ───────────────────────────────────────
 * Les jobs (réconciliation des paiements, sauvegarde de la base) tournent
 * seuls, la nuit. Sans cette lecture, un job qui échoue chaque nuit échoue en
 * silence : personne ne lit les logs d'un cron. La règle de la vague est donc
 * qu'un échec doit être VISIBLE dans le back-office, sans SSH et sans fichier
 * de log (lot J, AC J1).
 *
 * ─── RÈGLE DE CONSTRUCTION ────────────────────────────────────────────
 * Les requêtes vivent ici, les calculs (durée, série d'échecs) vivent dans
 * `src/domain/jobs.ts` où ils sont testés sans base. Ce fichier ne fait que
 * faire le pont et exposer des DTO prêts à afficher.
 */

import type { JobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  detectJobFailureAlerts,
  JOB_FAILURE_ALERT_THRESHOLD,
  jobDurationMs,
  type JobFailureAlert,
} from "@/domain/jobs";

/** Nombre d'exécutions affichées sur `/admin/taches` (AC J1 : les 20 dernières). */
export const RECENT_JOB_RUNS_LIMIT = 20;

/**
 * Fenêtre lue pour la détection d'alerte. 200 lignes couvrent confortablement
 * plusieurs jours d'exécutions horaires et restent une requête unique indexée
 * sur `[name, startedAt]`. On ne met pas 10 000 : l'alerte porte sur les
 * exécutions RÉCENTES, pas sur l'histoire de la boutique.
 */
export const JOB_ALERT_SCAN_LIMIT = 200;

/** Une exécution, telle qu'affichée (durée déjà calculée). */
export type JobRunRow = {
  id: string;
  name: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  /** `null` quand la durée n'est pas calculable (cf. `jobDurationMs`). */
  durationMs: number | null;
  error: string | null;
};

const RUN_SELECT = {
  id: true,
  name: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  error: true,
} as const;

/**
 * Les `limit` dernières exécutions, de la plus récente à la plus ancienne.
 *
 * L'ordre est total et déterministe : `startedAt` puis `id`. Deux jobs lancés
 * à la même seconde (c'est fréquent quand un cron en déclenche deux) doivent
 * s'afficher dans un ordre stable, sinon la page « saute » d'un rafraîchissement
 * à l'autre et l'opérateur croit à un doublon.
 *
 * `now` est un paramètre (défaut : maintenant) pour que les tests calculent la
 * durée d'un job `RUNNING` sans dépendre de l'heure d'exécution du test.
 */
export async function listRecentJobRuns(
  limit: number = RECENT_JOB_RUNS_LIMIT,
  now: Date = new Date(),
): Promise<JobRunRow[]> {
  const runs = await prisma.jobRun.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: RUN_SELECT,
  });

  return runs.map((run) => ({
    ...run,
    durationMs: jobDurationMs(run, now),
  }));
}

/**
 * Jobs dont les dernières exécutions ont TOUTES échoué (seuil : 3).
 *
 * Sert à la section « Alertes » du tableau de bord : une liste vide est une
 * information (« Aucune alerte »), pas un blanc à interpréter.
 */
export async function listJobFailureAlerts(
  threshold: number = JOB_FAILURE_ALERT_THRESHOLD,
): Promise<JobFailureAlert[]> {
  const runs = await prisma.jobRun.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: JOB_ALERT_SCAN_LIMIT,
    select: { name: true, status: true, error: true, startedAt: true },
  });

  return detectJobFailureAlerts(runs, threshold);
}
