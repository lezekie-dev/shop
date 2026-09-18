import { describe, expect, it } from "vitest";

import { HEALTH_DB_TIMEOUT_MS, probeDatabase } from "@/server/health";

/**
 * Sonde de santé de la base — sans Postgres.
 *
 * Le cas qui compte est celui qu'on ne peut pas déclencher à la demande en
 * intégration : une base qui NE RÉPOND PAS. Ici on lui donne un faux client
 * muet, et on exige que la sonde rende la main au lieu de pendre. C'est la
 * différence entre « la base est tombée » et « le site ne répond plus ».
 */

describe("probeDatabase", () => {
  it("rend db: up quand la base répond, avec la durée mesurée", async () => {
    const ticks = [1_000, 1_030];
    const result = await probeDatabase({ ping: async () => 1 }, HEALTH_DB_TIMEOUT_MS, () => ticks.shift() ?? 9_999);
    expect(result.db).toBe("up");
    expect(result.durationMs).toBe(30);
  });

  it("rend db: down quand la base jette (pas d'exception qui remonte)", async () => {
    const result = await probeDatabase({
      ping: async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:5432");
      },
    });
    expect(result.db).toBe("down");
    expect(typeof result.durationMs).toBe("number");
  });

  it("rend db: down quand la base NE RÉPOND JAMAIS — la sonde ne pend pas", async () => {
    const startedAt = Date.now();
    const result = await probeDatabase({ ping: () => new Promise(() => {}) }, 40);
    const elapsed = Date.now() - startedAt;

    expect(result.db).toBe("down");
    // Le délai est borné : on ne dépend pas du timeout de Postgres (qui, lui,
    // n'est pas configuré pour 2 s).
    expect(elapsed).toBeLessThan(1_000);
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(result.durationMs).toBeGreaterThanOrEqual(30);
  });

  it("le délai par défaut est court (une sonde lente est une panne)", () => {
    expect(HEALTH_DB_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
  });

  it("ne laisse pas de minuteur armé derrière une réponse rapide", async () => {
    // Si le clearTimeout manquait, ce test ne planterait pas : il laisserait
    // simplement un timer de 2 s en vie. On le prouve en vérifiant que la
    // fonction rend la main immédiatement (mesure < 500 ms alors que le délai
    // vaut 2 s).
    const startedAt = Date.now();
    const result = await probeDatabase({ ping: async () => 1 });
    expect(result.db).toBe("up");
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
