import { describe, expect, it } from "vitest";

import {
  computeNextReconcileAt,
  countVerdict,
  emptyReconcileMeta,
  isStalePending,
  needsManualReview,
  paymentAgeHours,
  RECONCILE_BATCH_SIZE,
  RECONCILE_JOB_NAME,
  RECONCILE_MAX_ATTEMPTS,
  RECONCILE_MAX_DELAY_MINUTES,
  reconcileDelayMinutes,
  verdictLabel,
} from "@/domain/payment/reconciliation";

/**
 * Politique de réconciliation (pur, aucune base) — CONVENTIONS §8 : au moins un
 * cas nominal, un cas limite et un cas d'erreur par fonction.
 *
 * Ces tests figent l'AC du PO mot pour mot : `nextReconcileAt = now() +
 * min(2^tentatives minutes, 24 h)`. Ils sont unitaires parce que le calcul du
 * délai n'a besoin ni de Postgres ni d'un faux fournisseur — et parce qu'un test
 * d'intégration qui attendrait réellement 24 h ne serait jamais exécuté.
 */

/** Secondes → millisecondes, pour lire les assertions en minutes. */
const MIN = 60_000;

describe("reconcileDelayMinutes — backoff 2^tentatives plafonné à 24 h", () => {
  it("suit la progression 2, 4, 8, 16… minutes", () => {
    expect([1, 2, 3, 4, 5].map(reconcileDelayMinutes)).toEqual([2, 4, 8, 16, 32]);
  });

  it("atteint le plafond de 24 h et n'en sort plus", () => {
    // 2^10 = 1024 min (17 h) restent sous le plafond, 2^11 = 2048 min le
    // dépassent : c'est la onzième tentative qui est écrêtée, pas la douzième.
    expect(reconcileDelayMinutes(10)).toBe(1024);
    expect(reconcileDelayMinutes(RECONCILE_MAX_ATTEMPTS)).toBe(RECONCILE_MAX_DELAY_MINUTES);
    expect(reconcileDelayMinutes(12)).toBe(RECONCILE_MAX_DELAY_MINUTES);
    expect(reconcileDelayMinutes(1_000)).toBe(RECONCILE_MAX_DELAY_MINUTES);
  });

  it("ne programme jamais « dans 0 minute » sur une entrée aberrante", () => {
    // Un compteur décrémenté ou absent ne doit pas transformer la tâche en
    // boucle serrée sur le fournisseur — c'est le piège R7 du brief.
    expect(reconcileDelayMinutes(0)).toBe(2);
    expect(reconcileDelayMinutes(-5)).toBe(2);
    expect(reconcileDelayMinutes(Number.NaN)).toBe(2);
    expect(reconcileDelayMinutes(2.9)).toBe(4);
  });

  it("RECONCILE_MAX_DELAY_MINUTES vaut bien 24 h", () => {
    expect(RECONCILE_MAX_DELAY_MINUTES).toBe(24 * 60);
  });
});

describe("computeNextReconcileAt", () => {
  it("ajoute le délai à l'instant reçu (jamais à l'heure courante)", () => {
    const now = new Date("2026-09-18T10:00:00.000Z");
    expect(computeNextReconcileAt(now, 1).toISOString()).toBe("2026-09-18T10:02:00.000Z");
    expect(computeNextReconcileAt(now, 3).toISOString()).toBe("2026-09-18T10:08:00.000Z");
  });

  it("plafonne à 24 h pour une tentative très élevée", () => {
    const now = new Date("2026-09-18T10:00:00.000Z");
    const next = computeNextReconcileAt(now, 40);
    expect(next.getTime() - now.getTime()).toBe(24 * 60 * MIN);
  });

  it("ne modifie pas la date reçue (pas d'effet de bord)", () => {
    const now = new Date("2026-09-18T10:00:00.000Z");
    const before = now.getTime();
    computeNextReconcileAt(now, 5);
    expect(now.getTime()).toBe(before);
  });
});

describe("needsManualReview — le moment où la machine passe la main", () => {
  it("reste faux tant que le backoff n'est pas au plafond", () => {
    expect(needsManualReview({ reconcileAttempts: 0 })).toBe(false);
    expect(needsManualReview({ reconcileAttempts: RECONCILE_MAX_ATTEMPTS - 1 })).toBe(false);
  });

  it("devient vrai à partir du plafond, et le reste", () => {
    expect(needsManualReview({ reconcileAttempts: RECONCILE_MAX_ATTEMPTS })).toBe(true);
    expect(needsManualReview({ reconcileAttempts: 500 })).toBe(true);
  });
});

describe("age et seuil des 24 h", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");

  it("compte en heures pleines", () => {
    expect(paymentAgeHours(new Date("2026-09-18T11:00:00.000Z"), now)).toBe(1);
    expect(paymentAgeHours(new Date("2026-09-17T12:30:00.000Z"), now)).toBe(23);
  });

  it("ne renvoie jamais un âge négatif (horloge serveur en avance)", () => {
    expect(paymentAgeHours(new Date("2026-09-18T13:00:00.000Z"), now)).toBe(0);
  });

  it("bascule à 24 h pleines, pas une minute avant", () => {
    expect(isStalePending(new Date("2026-09-17T12:01:00.000Z"), now)).toBe(false);
    expect(isStalePending(new Date("2026-09-17T12:00:00.000Z"), now)).toBe(true);
    expect(isStalePending(new Date("2026-09-16T12:00:00.000Z"), now)).toBe(true);
  });

  it("accepte un seuil explicite (compteur d'alerte)", () => {
    expect(isStalePending(new Date("2026-09-18T10:00:00.000Z"), now, 1)).toBe(true);
    expect(isStalePending(new Date("2026-09-18T11:30:00.000Z"), now, 1)).toBe(false);
  });
});

describe("comptage des verdicts (JobRun.meta)", () => {
  it("part de zéro et compte chaque verdict au bon endroit", () => {
    let meta = emptyReconcileMeta();
    expect(meta).toEqual({ checked: 0, succeeded: 0, failed: 0, stillPending: 0 });

    meta = countVerdict(meta, "succeeded");
    meta = countVerdict(meta, "pending");
    meta = countVerdict(meta, "failed");
    meta = countVerdict(meta, "error");

    expect(meta).toEqual({ checked: 4, succeeded: 1, failed: 2, stillPending: 1 });
  });

  it("ne modifie pas le compteur reçu", () => {
    const initial = emptyReconcileMeta();
    const next = countVerdict(initial, "succeeded");
    expect(initial).toEqual({ checked: 0, succeeded: 0, failed: 0, stillPending: 0 });
    expect(next).not.toBe(initial);
  });

  it("un verdict « déjà soldé » ne compte pas comme une attente", () => {
    expect(countVerdict(emptyReconcileMeta(), "not_pending")).toEqual({
      checked: 1,
      succeeded: 0,
      failed: 0,
      stillPending: 1,
    });
  });
});

describe("libellés et constantes partagées", () => {
  it("chaque verdict a un libellé lisible, jamais un code technique", () => {
    expect(verdictLabel("succeeded")).toBe("Confirmé");
    expect(verdictLabel("pending")).toBe("Toujours en attente");
    expect(verdictLabel("failed")).toBe("Échec");
    expect(verdictLabel("error")).toBe("Vérification impossible");
    expect(verdictLabel("not_pending")).toBe("Plus en attente");
  });

  it("le nom du job est le contrat lu par la page des tâches", () => {
    // `src/domain/jobs.ts` (chantier J) traduit ce nom littéral : le renommer
    // ici sans mise à jour ferait disparaître la tâche de l'écran du marchand.
    expect(RECONCILE_JOB_NAME).toBe("reconcile-payments");
  });

  it("le lot est borné (une tâche ne traite pas la table entière)", () => {
    expect(RECONCILE_BATCH_SIZE).toBeGreaterThan(0);
    expect(RECONCILE_BATCH_SIZE).toBeLessThanOrEqual(1_000);
  });
});
