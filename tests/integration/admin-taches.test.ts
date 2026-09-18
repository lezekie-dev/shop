import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { JobStatus } from "@prisma/client";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";
import AdminJobsPage from "@/app/(admin)/admin/taches/page";
import { listJobFailureAlerts, listRecentJobRuns } from "@/server/admin-jobs";
import { visibleNavItems } from "@/ui/components/admin/admin-nav";

/**
 * Journal des tâches planifiées — lecture réelle sur shop_test.
 *
 * ─── POURQUOI CE TEST INTERROGE LA PAGE ELLE-MÊME ─────────────────────
 * L'acceptation du PO est : « /admin/taches affiche les 20 derniers `JobRun`,
 * un job en échec est visible dans le back-office SANS SSH et sans lire un
 * fichier de log ». Tester seulement la requête ne prouverait pas l'affichage.
 * On appelle donc le composant de page et on parcourt son arbre React pour
 * extraire le TEXTE rendu — sans DOM ni navigateur (aucun test du projet n'en
 * utilise, et un vrai rendu exigerait un routeur Next absent en test).
 *
 * La garde serveur est mockée (elle lirait un cookie et redirigerait) : c'est
 * le seul point d'entrée simulé, et il est VÉRIFIÉ — on exige que la page
 * demande bien la capacité `jobs:read`, qui est celle que STAFF porte.
 */

const guards = vi.hoisted(() => ({
  requireCapability: vi.fn(async () => ({
    id: "staff-1",
    email: "staff@shop.local",
    name: "Fatou",
    role: "STAFF" as const,
    active: true,
  })),
}));

vi.mock("@/server/guards", () => ({ requireCapability: guards.requireCapability }));

// ─────────────────────────────────────────────────────────────────────
// Mini-rendu : extraire le texte visible d'un arbre d'éléments React
// ─────────────────────────────────────────────────────────────────────

function collectText(node: ReactNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }

  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function") {
    // Composant (y compris composant client) : on l'exécute comme le ferait le
    // rendu serveur, puis on descend dans son résultat.
    const rendered = (element.type as (props: unknown) => ReactNode)(element.props);
    collectText(rendered, out);
    return out;
  }
  // Type non appelable (fragment, forwardRef de next/link…) : on lit ses enfants.
  collectText(element.props?.children, out);
  return out;
}

async function renderedText(): Promise<string> {
  const tree = await AdminJobsPage();
  return collectText(tree).join(" ");
}

// ─────────────────────────────────────────────────────────────────────
// Fabriques
// ─────────────────────────────────────────────────────────────────────

let seq = 0;

async function createJobRun(opts: {
  name: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt?: Date | null;
  error?: string | null;
  meta?: Record<string, unknown>;
}): Promise<string> {
  seq += 1;
  const run = await prismaTest.jobRun.create({
    data: {
      name: opts.name,
      status: opts.status,
      startedAt: opts.startedAt,
      finishedAt: opts.finishedAt ?? null,
      error: opts.error ?? null,
      meta: (opts.meta ?? {}) as never,
    },
  });
  return run.id;
}

/** Date déterministe : `minutesAgo` minutes avant une origine fixe. */
const ORIGIN = Date.UTC(2026, 8, 18, 12, 0, 0);
function minutesAgo(minutes: number): Date {
  return new Date(ORIGIN - minutes * 60_000);
}

beforeEach(async () => {
  await resetDb();
  await seedFixtures();
  guards.requireCapability.mockClear();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────

describe("listRecentJobRuns", () => {
  it("renvoie au maximum 20 exécutions, de la plus récente à la plus ancienne", async () => {
    for (let i = 1; i <= 25; i += 1) {
      await createJobRun({
        name: `job-${`${i}`.padStart(2, "0")}`,
        status: "SUCCEEDED",
        startedAt: minutesAgo(25 - i),
      });
    }

    const runs = await listRecentJobRuns();
    expect(runs).toHaveLength(20);
    // Le plus récent (job-25) est en tête, le plus ancien de la fenêtre (job-06)
    // en queue : les 5 premiers n'apparaissent pas.
    expect(runs[0]?.name).toBe("job-25");
    expect(runs[19]?.name).toBe("job-06");
    expect(runs.map((r) => r.name)).not.toContain("job-05");
  });

  it("calcule la durée à partir de startedAt → finishedAt", async () => {
    await createJobRun({
      name: "backup-db",
      status: "SUCCEEDED",
      startedAt: new Date(ORIGIN),
      finishedAt: new Date(ORIGIN + 4_200),
    });
    // Un job en cours affiche le temps écoulé depuis son démarrage.
    await createJobRun({
      name: "reconcile-payments",
      status: "RUNNING",
      startedAt: new Date(ORIGIN - 60_000),
    });

    const runs = await listRecentJobRuns(20, new Date(ORIGIN + 10_000));
    const backup = runs.find((r) => r.name === "backup-db");
    const running = runs.find((r) => r.name === "reconcile-payments");

    expect(backup?.durationMs).toBe(4_200);
    expect(running?.durationMs).toBe(10_000 + 60_000);
    expect(running?.finishedAt).toBeNull();
  });

  it("remonte le message d'erreur d'une exécution en échec", async () => {
    await createJobRun({
      name: "backup-db",
      status: "FAILED",
      startedAt: new Date(ORIGIN),
      finishedAt: new Date(ORIGIN + 900),
      error: "pg_dump: connexion à la base refusée",
    });

    const runs = await listRecentJobRuns();
    expect(runs[0]?.status).toBe("FAILED");
    expect(runs[0]?.error).toBe("pg_dump: connexion à la base refusée");
  });
});

describe("page /admin/taches", () => {
  it("demande la capacité jobs:read (aucun `role === ADMIN`)", async () => {
    await renderedText();
    expect(guards.requireCapability).toHaveBeenCalledWith("jobs:read");
  });

  it("affiche les 20 derniers JobRun (nom, statut, durée)", async () => {
    for (let i = 1; i <= 25; i += 1) {
      await createJobRun({
        name: `job-${`${i}`.padStart(2, "0")}`,
        status: "SUCCEEDED",
        startedAt: minutesAgo(25 - i),
        finishedAt: new Date(minutesAgo(25 - i).getTime() + 2_500),
      });
    }

    const text = await renderedText();
    expect(text).toContain("job-25"); // le plus récent
    expect(text).toContain("job-06"); // le 20e de la fenêtre
    expect(text).not.toContain("job-05"); // hors fenêtre
    expect(text).toContain("Réussie");
    expect(text).toContain("2,5 s");
  });

  it("affiche un job en échec AVEC son message d'erreur (sans SSH, sans log)", async () => {
    await createJobRun({
      name: "backup-db",
      status: "FAILED",
      startedAt: minutesAgo(30),
      finishedAt: minutesAgo(30),
      error: "pg_dump: connexion à la base refusée (contneur shop-db)",
    });

    const text = await renderedText();
    expect(text).toContain("Sauvegarde de la base");
    expect(text).toContain("En échec");
    expect(text).toContain("pg_dump: connexion à la base refusée (contneur shop-db)");
  });

  it("distingue visuellement RUNNING / SUCCEEDED / FAILED", async () => {
    await createJobRun({ name: "encours", status: "RUNNING", startedAt: minutesAgo(1) });
    await createJobRun({ name: "reussi", status: "SUCCEEDED", startedAt: minutesAgo(2), finishedAt: minutesAgo(2) });
    await createJobRun({ name: "casse", status: "FAILED", startedAt: minutesAgo(3), finishedAt: minutesAgo(3), error: "boum" });

    const text = await renderedText();
    expect(text).toContain("En cours");
    expect(text).toContain("Réussie");
    expect(text).toContain("En échec");
    expect(text).toContain("1 en échec");
    expect(text).toContain("1 en cours");
  });

  it("explique l'état vide au lieu de laisser une page blanche", async () => {
    const text = await renderedText();
    expect(text).toContain("Aucune tâche exécutée");
  });
});

describe("alertes de tâches (dashboard)", () => {
  it("alerte après 3 échecs consécutifs du même job, avec le dernier message", async () => {
    for (const minutes of [1, 2, 3]) {
      await createJobRun({
        name: "backup-db",
        status: "FAILED",
        startedAt: minutesAgo(minutes),
        finishedAt: minutesAgo(minutes),
        error: `échec ${minutes}`,
      });
    }
    // Une exécution réussie plus ancienne ne doit pas changer l'alerte.
    await createJobRun({ name: "backup-db", status: "SUCCEEDED", startedAt: minutesAgo(4), finishedAt: minutesAgo(4) });
    // Un autre job qui a échoué une seule fois ne déclenche rien.
    await createJobRun({ name: "reconcile-payments", status: "FAILED", startedAt: minutesAgo(5), finishedAt: minutesAgo(5) });

    const alerts = await listJobFailureAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.name).toBe("backup-db");
    expect(alerts[0]?.consecutiveFailures).toBe(3);
    expect(alerts[0]?.lastError).toBe("échec 1");
  });

  it("l'alerte disparaît dès qu'une exécution réussit", async () => {
    for (const minutes of [2, 3, 4]) {
      await createJobRun({ name: "backup-db", status: "FAILED", startedAt: minutesAgo(minutes), finishedAt: minutesAgo(minutes) });
    }
    expect(await listJobFailureAlerts()).toHaveLength(1);

    await createJobRun({ name: "backup-db", status: "SUCCEEDED", startedAt: minutesAgo(1), finishedAt: minutesAgo(1) });
    expect(await listJobFailureAlerts()).toEqual([]);
  });
});

describe("navigation", () => {
  it("expose /admin/taches à STAFF avec la capacité jobs:read", () => {
    const items = visibleNavItems("STAFF");
    const entry = items.find((item) => item.href === "/admin/taches");
    expect(entry).toBeDefined();
    expect(entry?.capability).toBe("jobs:read");
    expect(entry?.label).toBe("Tâches");
  });
});
