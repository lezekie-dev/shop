import { describe, expect, it } from "vitest";
import type { JobStatus } from "@prisma/client";

import {
  JOB_FAILURE_ALERT_THRESHOLD,
  consecutiveFailures,
  detectJobFailureAlerts,
  formatJobDuration,
  isJobStatus,
  jobDurationMs,
  jobLabel,
  jobStatusLabel,
  type JobRunSignal,
} from "@/domain/jobs";
import { can } from "@/domain/access";

/**
 * Journal des tâches planifiées — calculs purs, aucune base, aucun mock.
 *
 * Ces tests figent deux comportements sur lesquels le back-office s'appuie :
 * la durée affichée ne doit jamais être inventée, et l'alerte ne doit se
 * déclencher que sur une série d'échecs RÉELLE et récente.
 */

function signal(name: string, status: JobStatus, minutesAgo: number, error: string | null = null): JobRunSignal {
  return {
    name,
    status,
    error,
    startedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, 0) - minutesAgo * 60_000),
  };
}

describe("jobStatusLabel / isJobStatus", () => {
  it("traduit les trois statuts et refuse le reste", () => {
    expect(jobStatusLabel("RUNNING")).toBe("En cours");
    expect(jobStatusLabel("SUCCEEDED")).toBe("Réussie");
    expect(jobStatusLabel("FAILED")).toBe("En échec");
    expect(isJobStatus("FAILED")).toBe(true);
    expect(isJobStatus("failed")).toBe(false);
    expect(isJobStatus("")).toBe(false);
  });
});

describe("jobDurationMs", () => {
  const now = new Date(Date.UTC(2026, 8, 18, 12, 0, 0));

  it("calcule la durée d'un job terminé", () => {
    const duration = jobDurationMs(
      {
        status: "SUCCEEDED",
        startedAt: new Date(Date.UTC(2026, 8, 18, 11, 59, 0)),
        finishedAt: new Date(Date.UTC(2026, 8, 18, 11, 59, 3, 400)),
      },
      now,
    );
    expect(duration).toBe(3_400);
  });

  it("calcule le temps écoulé d'un job EN COURS (pour repérer une tâche bloquée)", () => {
    const duration = jobDurationMs(
      { status: "RUNNING", startedAt: new Date(Date.UTC(2026, 8, 18, 11, 55, 0)), finishedAt: null },
      now,
    );
    expect(duration).toBe(5 * 60_000);
  });

  it("n'invente pas de durée quand la donnée manque", () => {
    expect(
      jobDurationMs({ status: "FAILED", startedAt: now, finishedAt: null }, now),
    ).toBeNull();
  });

  it("ne renvoie jamais une durée négative (horloge qui recule)", () => {
    expect(
      jobDurationMs(
        {
          status: "SUCCEEDED",
          startedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, 5)),
          finishedAt: new Date(Date.UTC(2026, 8, 18, 12, 0, 0)),
        },
        now,
      ),
    ).toBe(0);
  });
});

describe("formatJobDuration", () => {
  it("affiche « — » plutôt que 0 quand la durée est inconnue", () => {
    expect(formatJobDuration(null)).toBe("—");
    expect(formatJobDuration(0)).toBe("0 ms");
  });

  it("adapte l'unité à l'ordre de grandeur", () => {
    expect(formatJobDuration(250)).toBe("250 ms");
    expect(formatJobDuration(3_400)).toBe("3,4 s");
    expect(formatJobDuration(65_000)).toBe("1 min 05 s");
    expect(formatJobDuration(3_725_000)).toBe("1 h 02 min");
  });
});

describe("consecutiveFailures", () => {
  it("compte la série d'échecs en tête de liste (plus récent d'abord)", () => {
    expect(consecutiveFailures(["FAILED", "FAILED", "FAILED"])).toBe(3);
    expect(consecutiveFailures(["FAILED", "SUCCEEDED", "FAILED"])).toBe(1);
    expect(consecutiveFailures(["SUCCEEDED", "FAILED"])).toBe(0);
    expect(consecutiveFailures([])).toBe(0);
  });

  it("un job EN COURS interrompt la série : on ne crie pas avant de savoir", () => {
    expect(consecutiveFailures(["RUNNING", "FAILED", "FAILED", "FAILED"])).toBe(0);
  });
});

describe("detectJobFailureAlerts", () => {
  it("ne déclenche rien sous le seuil", () => {
    const runs = [signal("backup-db", "FAILED", 1), signal("backup-db", "FAILED", 2)];
    expect(detectJobFailureAlerts(runs)).toEqual([]);
  });

  it("déclenche au seuil et remonte la dernière erreur", () => {
    const runs = [
      signal("backup-db", "FAILED", 1, "pg_dump: connexion refusée"),
      signal("backup-db", "FAILED", 2),
      signal("backup-db", "FAILED", 3),
    ];
    const alerts = detectJobFailureAlerts(runs);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.name).toBe("backup-db");
    expect(alerts[0]?.consecutiveFailures).toBe(3);
    expect(alerts[0]?.lastError).toBe("pg_dump: connexion refusée");
  });

  it("ne mélange pas les jobs entre eux", () => {
    const runs = [
      signal("reconcile-payments", "FAILED", 1),
      signal("reconcile-payments", "FAILED", 2),
      signal("reconcile-payments", "FAILED", 3),
      signal("backup-db", "SUCCEEDED", 4),
      signal("backup-db", "FAILED", 5),
    ];
    const alerts = detectJobFailureAlerts(runs);
    expect(alerts.map((a) => a.name)).toEqual(["reconcile-payments"]);
  });

  it("trie par nombre d'échecs décroissant, puis par nom", () => {
    const runs = [
      signal("bbb", "FAILED", 1),
      signal("bbb", "FAILED", 2),
      signal("bbb", "FAILED", 3),
      signal("aaa", "FAILED", 1),
      signal("aaa", "FAILED", 2),
      signal("aaa", "FAILED", 3),
      signal("aaa", "FAILED", 4),
    ];
    expect(detectJobFailureAlerts(runs).map((a) => a.name)).toEqual(["aaa", "bbb"]);
  });

  it("le seuil par défaut est bien 3 (celui du PO)", () => {
    expect(JOB_FAILURE_ALERT_THRESHOLD).toBe(3);
  });
});

describe("jobLabel", () => {
  it("traduit les jobs connus et laisse passer un job inconnu", () => {
    expect(jobLabel("backup-db")).toBe("Sauvegarde de la base");
    expect(jobLabel("job-du-futur")).toBe("job-du-futur");
  });
});

describe("capacité jobs:read", () => {
  it("est portée par ADMIN ET STAFF (page de lecture, aucune donnée financière)", () => {
    expect(can("ADMIN", "jobs:read")).toBe(true);
    expect(can("STAFF", "jobs:read")).toBe(true);
  });
});
