import { describe, expect, it } from "vitest";

import {
  authorizeCronRequest,
  constantTimeSecretEquals,
  CRON_SECRET_HEADER,
  readCronSecret,
} from "@/server/cron-auth";

/**
 * Authentification du déclencheur de cron — la seule surface de ce chantier
 * qui est exposée à Internet sans session.
 *
 * Ce qui est testé ici n'est pas « ça marche » mais les trois refus : pas de
 * secret configuré, pas de secret présenté, secret faux. Un déclencheur de
 * tâche qui laisse passer dans un de ces cas permet à n'importe qui de faire
 * tourner la réconciliation en boucle.
 */

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("constantTimeSecretEquals", () => {
  it("accepte deux secrets identiques", () => {
    expect(constantTimeSecretEquals("s3cr3t-long-et-pas-facile", "s3cr3t-long-et-pas-facile")).toBe(
      true,
    );
  });

  it("refuse un secret différent, même d'un seul caractère", () => {
    expect(constantTimeSecretEquals("s3cr3t", "s3cr4t")).toBe(false);
  });

  it("refuse un préfixe correct et une chaîne vide", () => {
    expect(constantTimeSecretEquals("s3cr3t", "s3cr3t-plus-long")).toBe(false);
    expect(constantTimeSecretEquals("", "s3cr3t")).toBe(false);
    expect(constantTimeSecretEquals("s3cr3t", "")).toBe(false);
  });

  it("ne lève JAMAIS, quelles que soient les longueurs (pas de timingSafeEqual nu)", () => {
    // `crypto.timingSafeEqual` lève sur des longueurs différentes : c'est
    // précisément ce que le passage par SHA-256 évite.
    expect(() => constantTimeSecretEquals("a", "a".repeat(10_000))).not.toThrow();
  });
});

describe("readCronSecret", () => {
  it("lit l'en-tête dédié", () => {
    expect(readCronSecret(headers({ [CRON_SECRET_HEADER]: "abc" }))).toBe("abc");
  });

  it("accepte aussi Authorization: Bearer", () => {
    expect(readCronSecret(headers({ authorization: "Bearer abc" }))).toBe("abc");
    expect(readCronSecret(headers({ authorization: "bearer abc" }))).toBe("abc");
  });

  it("ignore un schéma d'autorisation qui n'est pas Bearer", () => {
    expect(readCronSecret(headers({ authorization: "Basic abc" }))).toBeNull();
    expect(readCronSecret(headers({ authorization: "Bearer    " }))).toBeNull();
  });

  it("renvoie null quand aucun secret n'est présenté", () => {
    expect(readCronSecret(headers())).toBeNull();
  });
});

describe("authorizeCronRequest", () => {
  it("laisse passer avec le bon secret", () => {
    expect(
      authorizeCronRequest(headers({ [CRON_SECRET_HEADER]: "abc" }), { CRON_SECRET: "abc" }),
    ).toEqual({ ok: true });
  });

  it("refuse en 401 sans secret présenté", () => {
    const result = authorizeCronRequest(headers(), { CRON_SECRET: "abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
  });

  it("refuse en 401 avec un mauvais secret", () => {
    const result = authorizeCronRequest(headers({ [CRON_SECRET_HEADER]: "zzz" }), {
      CRON_SECRET: "abc",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
  });

  it("refuse en 503 quand le serveur n'a pas de CRON_SECRET — jamais un passage libre", () => {
    for (const configured of [undefined, ""]) {
      const result = authorizeCronRequest(headers({ [CRON_SECRET_HEADER]: "abc" }), {
        CRON_SECRET: configured,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(503);
      expect(result.message).toContain("CRON_SECRET");
    }
  });
});
