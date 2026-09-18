/**
 * Politique de réconciliation des paiements bloqués — TypeScript pur
 * (cf. CONVENTIONS §2 : pas de Prisma, pas de Next, pas de `Date.now()`).
 *
 * POURQUOI CE MODULE EXISTE
 * Un paiement `PENDING` a deux issues aujourd'hui, toutes les deux mauvaises :
 * il reste bloqué pour toujours (le stock réservé ne redescend jamais — stock
 * fantôme = rupture de vente invisible) ou le marchand expédie sans être payé.
 * La tâche `reconcile-payments` réinterroge le fournisseur d'origine ; ce
 * fichier porte la seule décision de cadence : QUAND réinterroger, et à partir
 * de quand un paiement ne relève plus de la machine mais d'un humain.
 *
 * Il est pur pour deux raisons : les tests de cadence n'ont besoin ni de base
 * ni de mock (l'heure est un paramètre `now`), et la politique de temps est
 * lisible à UN seul endroit plutôt que dispersée dans une boucle SQL.
 */

/**
 * Nom du job écrit dans `JobRun`. C'est un CONTRAT : `src/domain/jobs.ts`
 * (chantier J) traduit ce nom pour la page `/admin/taches`, et un renommage
 * silencieux ferait disparaître la tâche de l'écran du marchand.
 */
export const RECONCILE_JOB_NAME = "reconcile-payments";

/**
 * Paiements traités par exécution. Borné volontairement : une tâche planifiée
 * qui interroge 5 000 fournisseurs en série dépasse le délai du cron et se fait
 * tuer au milieu d'un lot, sans trace lisible. Les plus urgents passent
 * d'abord (le plus ancien en tête), donc le reste est traité à l'exécution
 * suivante — jamais perdu.
 */
export const RECONCILE_BATCH_SIZE = 100;

/** Base du backoff : 2^tentatives minutes (2, 4, 8, 16…). */
export const RECONCILE_BASE_DELAY_MINUTES = 2;

/**
 * Plafond du backoff : 24 h. Au-delà, on n'interroge plus souvent qu'une fois
 * par jour — un fournisseur muet ne doit pas se faire marteler, et un humain
 * doit avoir le temps de trancher.
 */
export const RECONCILE_MAX_DELAY_MINUTES = 24 * 60;

/**
 * Première tentative dont le délai est ÉCRÊTÉ par le plafond (11 : 2^11 = 2048
 * min > 1440). Calculé et non écrit à la main : le jour où l'on change la base
 * ou le plafond, cette valeur suit au lieu de mentir.
 */
export const RECONCILE_MAX_ATTEMPTS = (() => {
  let attempts = 1;
  while (RECONCILE_BASE_DELAY_MINUTES ** attempts < RECONCILE_MAX_DELAY_MINUTES) {
    attempts += 1;
  }
  return attempts;
})();

/**
 * Délai avant la prochaine interrogation, en minutes.
 *
 * `attempts` est le compteur APRÈS incrément (l'AC du PO dit :
 * `reconcileAttempts += 1` PUIS `nextReconcileAt = now() + min(2^attempts, 24 h)`).
 * Une valeur non finie ou < 1 retombe sur 1 : on ne programme jamais une
 * vérification « dans 0 minute », qui ferait boucler le job sur lui-même.
 */
export function reconcileDelayMinutes(attempts: number): number {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(
    RECONCILE_BASE_DELAY_MINUTES ** safeAttempts,
    RECONCILE_MAX_DELAY_MINUTES,
  );
}

/** Même délai en millisecondes — pour la comparaison de dates. */
export function reconcileDelayMs(attempts: number): number {
  return reconcileDelayMinutes(attempts) * 60_000;
}

/** Instant de la prochaine interrogation. `now` est injecté (règle §2). */
export function computeNextReconcileAt(now: Date, attempts: number): Date {
  return new Date(now.getTime() + reconcileDelayMs(attempts));
}

/**
 * `true` quand la machine a fait ce qu'elle pouvait : le backoff est au
 * plafond, le paiement est en attente depuis des jours. La décision (annuler,
 * relancer le client, confirmer à la main) appartient au marchand — décision
 * D6, et c'est pour ça que rien n'est libéré automatiquement.
 */
export function needsManualReview(payment: { reconcileAttempts: number }): boolean {
  return payment.reconcileAttempts >= RECONCILE_MAX_ATTEMPTS;
}

/** Seuil du compteur d'alerte « PENDING > 24 h : N » (KPI K9, cible 0). */
export const STALE_PAYMENT_HOURS = 24;

/** Âge d'un paiement en heures pleines, jamais négatif (horloge en avance). */
export function paymentAgeHours(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000));
}

/**
 * Un paiement en attente depuis plus de `hours` heures.
 *
 * En heures PLEINES : un paiement de 24 h 30 min est « > 24 h », un paiement de
 * 23 h 59 ne l'est pas. Le seuil est le même que celui affiché sur la page —
 * une alerte calculée autrement que le compteur qu'elle explique est
 * incompréhensible.
 */
export function isStalePending(
  createdAt: Date,
  now: Date,
  hours: number = STALE_PAYMENT_HOURS,
): boolean {
  return paymentAgeHours(createdAt, now) >= hours;
}

/**
 * Verdict d'une vérification, du point de vue du marchand.
 *
 *   succeeded   : le fournisseur confirme, la commande est payée
 *   pending     : le fournisseur ne sait toujours pas — on repassera
 *   failed      : le fournisseur déclare l'échec (la commande N'EST PAS annulée)
 *   error       : on n'a PAS pu savoir (fournisseur injoignable, refus de
 *                 transition) — c'est le seul cas qui mérite une investigation
 *   not_pending : le paiement n'était plus en attente, rien à vérifier
 */
export type ReconcileVerdict =
  | "succeeded"
  | "pending"
  | "failed"
  | "error"
  | "not_pending";

const VERDICT_LABELS: Record<ReconcileVerdict, string> = {
  succeeded: "Confirmé",
  pending: "Toujours en attente",
  failed: "Échec",
  error: "Vérification impossible",
  not_pending: "Plus en attente",
};

/** Libellé lisible par le marchand — jamais un code technique à l'écran. */
export function verdictLabel(verdict: ReconcileVerdict): string {
  return VERDICT_LABELS[verdict];
}

/**
 * Compteurs écrits dans `JobRun.meta` à CHAQUE exécution.
 *
 * `failed` regroupe « le fournisseur a dit non » et « on n'a pas pu savoir » :
 * du point de vue du marchand, ce sont les deux cas qui méritent un coup d'œil,
 * et `error` est déjà porté par le message de l'exécution. Les séparer
 * donnerait un compteur `errors` que personne ne lirait.
 */
export type ReconcileJobMeta = {
  checked: number;
  succeeded: number;
  failed: number;
  stillPending: number;
};

/** Métadonnées d'une exécution vide — point de départ d'un comptage. */
export function emptyReconcileMeta(): ReconcileJobMeta {
  return { checked: 0, succeeded: 0, failed: 0, stillPending: 0 };
}

/**
 * Incrémente le bon compteur selon le verdict. Fonction pure plutôt que
 * `switch` dispersé : un verdict ajouté demain ne peut pas être oublié dans un
 * des deux comptages (job et résumé).
 */
export function countVerdict(meta: ReconcileJobMeta, verdict: ReconcileVerdict): ReconcileJobMeta {
  const next: ReconcileJobMeta = { ...meta, checked: meta.checked + 1 };
  if (verdict === "succeeded") next.succeeded += 1;
  else if (verdict === "pending" || verdict === "not_pending") next.stillPending += 1;
  else next.failed += 1;
  return next;
}
