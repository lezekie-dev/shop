import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import {
  checkLoginRateLimit,
  clientIpFromHeaders,
  pruneOldLoginAttempts,
  recordLoginAttempt,
} from "@/server/login-rate-limit";

/**
 * Rate limiting de la connexion admin.
 *
 * Contrat vérifié ici :
 *   - sous le seuil, on laisse passer
 *   - au seuil, on bloque — par identifiant ET par IP (deux attaques différentes)
 *   - une connexion réussie remet le compteur du compte à zéro
 *   - l'IP est lue de `cf-connecting-ip` en priorité, sinon le PREMIER maillon
 *     de `x-forwarded-for` (le dernier est falsifiable par le client)
 */

async function clean(): Promise<void> {
  await prisma.loginAttempt.deleteMany({});
}

const EMAIL = "admin@shop.local";
const IP = "203.0.113.42";

describe("checkLoginRateLimit", () => {
  beforeEach(clean);

  it("laisse passer quand aucune tentative n'a été enregistrée", async () => {
    const v = await checkLoginRateLimit({ identifier: EMAIL, ip: IP });
    expect(v.allowed).toBe(true);
  });

  it("laisse passer sous le seuil (4 échecs sur 5 tolérés)", async () => {
    for (let i = 0; i < 4; i++) {
      await recordLoginAttempt({ identifier: EMAIL, succeeded: false, ip: IP });
    }
    const v = await checkLoginRateLimit({ identifier: EMAIL, ip: IP });
    expect(v.allowed).toBe(true);
  });

  it("bloque au 5e échec pour le même identifiant", async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt({ identifier: EMAIL, succeeded: false, ip: IP });
    }
    const v = await checkLoginRateLimit({ identifier: EMAIL, ip: IP });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.scope).toBe("identifier");
      expect(v.retryAfterSeconds).toBeGreaterThan(0);
      // Le délai annoncé doit rester dans la fenêtre de 15 min.
      expect(v.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it("bloque une IP qui essaie beaucoup d'identifiants différents", async () => {
    // Bourrage d'identifiants : 20 emails distincts depuis la même IP.
    for (let i = 0; i < 20; i++) {
      await recordLoginAttempt({
        identifier: `cible${i}@example.com`,
        succeeded: false,
        ip: IP,
      });
    }
    const v = await checkLoginRateLimit({ identifier: "nouveau@example.com", ip: IP });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.scope).toBe("ip");
  });

  it("l'identifiant est insensible à la casse", async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt({ identifier: "Admin@Shop.Local", succeeded: false, ip: IP });
    }
    const v = await checkLoginRateLimit({ identifier: "admin@shop.local", ip: IP });
    expect(v.allowed).toBe(false);
  });

  it("une connexion réussie remet le compteur à zéro", async () => {
    for (let i = 0; i < 4; i++) {
      await recordLoginAttempt({ identifier: EMAIL, succeeded: false, ip: IP });
    }
    // L'utilisateur retrouve enfin son mot de passe.
    await recordLoginAttempt({ identifier: EMAIL, succeeded: true, ip: IP });

    const remaining = await prisma.loginAttempt.count({
      where: { identifier: EMAIL, succeeded: false },
    });
    expect(remaining).toBe(0);

    const v = await checkLoginRateLimit({ identifier: EMAIL, ip: IP });
    expect(v.allowed).toBe(true);
  });

  it("ne bloque pas un AUTRE compte depuis la même IP sous le seuil IP", async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt({ identifier: EMAIL, succeeded: false, ip: IP });
    }
    // Le compte visé est bloqué…
    expect((await checkLoginRateLimit({ identifier: EMAIL, ip: IP })).allowed).toBe(false);
    // …mais pas un collègue légitime sur la même IP (5 < 20).
    const colleague = await checkLoginRateLimit({ identifier: "autre@shop.local", ip: IP });
    expect(colleague.allowed).toBe(true);
  });

  it("ne bloque pas une IP différente visant le même compte sous le seuil identifiant", async () => {
    for (let i = 0; i < 3; i++) {
      await recordLoginAttempt({ identifier: EMAIL, succeeded: false, ip: IP });
    }
    const other = await checkLoginRateLimit({ identifier: EMAIL, ip: "198.51.100.7" });
    expect(other.allowed).toBe(true);
  });

  it("un échec ancien hors fenêtre ne compte plus", async () => {
    await prisma.loginAttempt.create({
      data: {
        identifier: EMAIL,
        succeeded: false,
        ip: IP,
        createdAt: new Date(Date.now() - 16 * 60 * 1000), // 16 min : hors fenêtre
      },
    });
    const v = await checkLoginRateLimit({ identifier: EMAIL, ip: IP });
    expect(v.allowed).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("préfère cf-connecting-ip (posée par Cloudflare, non falsifiable)", () => {
    const h = new Headers();
    h.set("cf-connecting-ip", "203.0.113.42");
    h.set("x-forwarded-for", "1.2.3.4, 5.6.7.8");
    expect(clientIpFromHeaders(h)).toBe("203.0.113.42");
  });

  it("sinon prend le PREMIER maillon de x-forwarded-for", () => {
    // Le dernier maillon est ajouté par le proxy le plus proche : un client
    // peut le falsifier. L'origine réelle est en tête de chaîne.
    const h = new Headers();
    h.set("x-forwarded-for", "203.0.113.9, 10.0.0.1, 172.16.0.1");
    expect(clientIpFromHeaders(h)).toBe("203.0.113.9");
  });

  it("renvoie null sans aucun en-tête d'IP", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});

describe("pruneOldLoginAttempts", () => {
  beforeEach(clean);

  it("supprime les tentatives de plus de 24 h et garde les récentes", async () => {
    await prisma.loginAttempt.create({
      data: {
        identifier: EMAIL,
        succeeded: false,
        ip: IP,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    await recordLoginAttempt({ identifier: EMAIL, succeeded: false, ip: IP });

    const removed = await pruneOldLoginAttempts();
    expect(removed).toBe(1);
    expect(await prisma.loginAttempt.count()).toBe(1);
  });
});
