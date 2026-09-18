import { describe, expect, it, vi } from "vitest";

/**
 * Sonde de santé — le cas qui justifie tout le chantier : la base est MORTE.
 *
 * On ne peut pas éteindre `shop_test` pendant la suite (les autres tests
 * tournent sur la même base). On remplace donc le client Prisma par un client
 * qui échoue — et dont le message d'erreur contient volontairement une chaîne
 * de connexion avec mot de passe : c'est exactement ce qu'un provider renvoie
 * en vrai, et c'est exactement ce que la réponse publique ne doit PAS laisser
 * fuiter.
 *
 * Le `vi.mock` est par FILE : ce test doit rester seul dans son fichier,
 * sinon les autres tests de /api/health hériteraient d'une base morte.
 */

const DSN_INTERNE = "postgresql://shop:motdepasse-interne@127.0.0.1:5432/shop";

vi.mock("@/lib/db", () => ({
  prisma: {
    // Appelé comme tag de template par la route : on rend une promesse rejetée.
    $queryRaw: () => Promise.reject(new Error(`Échec de connexion à ${DSN_INTERNE}`)),
  },
}));

// Import APRÈS le mock (hoisté par Vitest, mais l'ordre du fichier reste lisible).
import { GET } from "@/app/api/health/route";

describe("GET /api/health — base injoignable", () => {
  it("répond 503 (et non 200) quand la base ne répond pas", async () => {
    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.db).toBe("down");
    expect(typeof body.version).toBe("string");
    expect(typeof body.durationMs).toBe("number");
  });

  it("ne laisse pas fuiter la chaîne de connexion ni le mot de passe de l'erreur interne", async () => {
    const raw = await (await GET()).clone().text();

    expect(raw).not.toContain(DSN_INTERNE);
    expect(raw).not.toContain("motdepasse-interne");
    expect(raw).not.toMatch(/postgres/i);
    expect(raw).not.toMatch(/motdepasse/);
  });
});
