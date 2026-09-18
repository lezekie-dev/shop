/**
 * Sonde de santé de la base — le seul endroit qui décide « la base répond »
 * ou « la base ne répond pas ».
 *
 * POURQUOI CE N'EST PAS DANS LA ROUTE (`app/api/health/route.ts`)
 * La route doit rester un handler de 5 lignes (CONVENTIONS §2). Surtout, la
 * décision « up / down » doit être testable SANS base : ici elle prend un
 * objet qui sait juste « pinguer » la base, donc un test peut lui donner un
 * faux client qui échoue ou qui ne répond jamais. C'est ce qui permet de
 * prouver le 503 sans débrancher Postgres.
 *
 * POURQUOI UN TIMEOUT COURT
 * Une sonde de santé qui pend est une panne en soi : le healthcheck Docker et
 * le load-balancer attendent, l'orchestrateur ne peut pas redémarrer un
 * conteneur qu'il croit encore vivant. Si la base ne répond pas en quelques
 * secondes, on considère qu'elle ne répond pas — et on le DIT (503) au lieu de
 * laisser la requête ouverte.
 *
 * DÉTAIL ASSUMÉ : à l'expiration du délai, la requête SQL sous-jacente n'est
 * pas annulée côté PostgreSQL (Prisma n'expose pas d'annulation de requête en
 * cours). Elle finira par expirer d'elle-même avec le pool de connexions. Le
 * coût est une connexion occupée quelques secondes de plus ; le bénéfice est
 * une sonde qui répond toujours en moins de `HEALTH_DB_TIMEOUT_MS`.
 */

/** Délai maximal accordé à la base pour répondre à la sonde (2 s). */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

/** Ce dont la sonde a besoin du client Prisma : un ping qui peut échouer. */
export type HealthDbClient = {
  ping: () => Promise<unknown>;
};

export type DbHealth = {
  db: "up" | "down";
  /** Temps réellement passé dans la vérification, en millisecondes. */
  durationMs: number;
};

/**
 * Vérifie que la base répond, en bornant l'attente.
 *
 * Ne lève JAMAIS : la sonde de santé ne doit pas pouvoir faire tomber la route
 * sur une exception non maîtrisée. Toute erreur (connexion refusée, timeout,
 * base inexistante, droits) devient `db: "down"` — c'est exactement ce que la
 * sonde doit signaler.
 *
 * `now` est injectable pour que les tests contrôlent la durée mesurée.
 */
export async function probeDatabase(
  client: HealthDbClient,
  timeoutMs: number = HEALTH_DB_TIMEOUT_MS,
  now: () => number = () => Date.now(),
): Promise<DbHealth> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      client.ping(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("health:db-timeout")), timeoutMs);
      }),
    ]);
    return { db: "up", durationMs: Math.max(0, now() - startedAt) };
  } catch {
    return { db: "down", durationMs: Math.max(0, now() - startedAt) };
  } finally {
    // Sans ce clearTimeout, un timer de 2 s resterait armé après une réponse
    // rapide : en production (plusieurs milliers de sondes par jour) c'est de
    // la mémoire retenue pour rien, et Vitest garderait le process en vie.
    if (timer) clearTimeout(timer);
  }
}
