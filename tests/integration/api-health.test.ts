import { afterAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

import { prismaTest } from "../helpers/prisma-test";

/**
 * Sonde de santé — base RÉELLE (shop_test), contrat complet.
 *
 * Le fichier jumeau `api-health-down.test.ts` couvre le cas « base morte » avec
 * un client simulé : ici on vérifie ce que la production renverra quand tout va
 * bien, et surtout que la réponse ne contient AUCUN secret.
 */

/** Variables dont la valeur ne doit jamais apparaître dans une réponse publique. */
const SECRET_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_TEST",
  "SESSION_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

afterAll(async () => {
  await prismaTest.$disconnect();
});

describe("GET /api/health", () => {
  it("répond 200 avec db: up quand la base répond", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("up");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.durationMs).toBe("number");
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.durationMs).toBeLessThan(5_000);
  });

  it("n'expose QUE les quatre clés du contrat", async () => {
    const body = await (await GET()).json();
    // Un champ ajouté par inadvertance est une fuite potentielle : le contrat
    // est figé ici, l'ajout d'une clé est un choix conscient (et testé).
    expect(Object.keys(body).sort()).toEqual(["db", "durationMs", "ok", "version"]);
  });

  it("ne contient ni chaîne de connexion, ni mot de passe, ni secret d'environnement", async () => {
    const res = await GET();
    const raw = await res.clone().text();

    expect(raw).not.toMatch(/postgres/i);
    expect(raw).not.toMatch(/:\/\//); // any URL/DSN
    expect(raw).not.toMatch(/password|secret|token|whsec_/i);

    for (const key of SECRET_ENV_KEYS) {
      const value = process.env[key];
      // On ne teste que les valeurs réellement présentes et significatives :
      // comparer une chaîne vide passerait toujours et ne prouverait rien.
      if (value && value.length >= 6) {
        expect(raw).not.toContain(value);
      }
    }
  });

  it("interdit la mise en cache (une sonde périmée vaut zéro)", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
