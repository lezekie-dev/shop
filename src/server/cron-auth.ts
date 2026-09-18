/**
 * Authentification des routes de cron — un secret partagé, comparé à temps
 * constant.
 *
 * POURQUOI PAS `provided === secret`
 * Une comparaison de chaînes JavaScript s'arrête au premier caractère
 * différent : le temps de réponse dépend du nombre de caractères corrects, ce
 * qui permet à un attaquant patient de reconstituer un secret caractère par
 * caractère en mesurant les réponses. `timingSafeEqual` compare des tampons de
 * longueur fixe sans s'arrêter au premier écart.
 *
 * POURQUOI ON HACHE AVANT DE COMPARER
 * `timingSafeEqual` LÈVE sur deux tampons de longueurs différentes — donc
 * comparer les chaînes brutes ferait fuiter la LONGUEUR du secret (par le code
 * d'erreur) et forcerait un `if (a.length !== b.length)` qui rejoue le
 * problème. En passant les deux côtés par SHA-256, les tampons font toujours
 * 32 octets : la comparaison est à temps constant, sans exception possible.
 *
 * Le secret vit dans `CRON_SECRET` et n'est PAS dans le schéma zod de
 * `src/lib/env.ts` : son absence n'empêche personne de naviguer dans la
 * boutique, elle empêche seulement de déclencher la tâche à la main. Un boot
 * fail-fast sur cette variable empêcherait un redémarrage pour rien — on
 * répond 503 sur la route concernée, avec un message qui dit quoi faire.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** En-tête attendu par la route (le plus explicite des deux acceptés). */
export const CRON_SECRET_HEADER = "x-cron-secret";

/** Résultat de l'autorisation : soit on passe, soit on répond sans exécuter. */
export type CronAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

/**
 * Comparaison à temps constant de deux secrets, sans exception possible.
 */
export function constantTimeSecretEquals(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Secret présenté par l'appelant : en-tête dédié, ou `Authorization: Bearer`.
 *
 * Les deux sont acceptés parce que les planificateurs disponibles (cron
 * système, planificateur Coolify, `curl` en ligne de commande) n'ont pas tous
 * la même souplesse : imposer une seule forme fait écrire des scripts qui
 * mettent le secret dans l'URL, où il finit dans les logs d'accès.
 * Renvoie `null` si aucun secret n'est présent — un appelant sans secret n'est
 * pas une tentative de deviner le secret, il n'y a rien à comparer.
 */
export function readCronSecret(headers: Headers): string | null {
  const direct = headers.get(CRON_SECRET_HEADER);
  if (direct) return direct;

  const authorization = headers.get("authorization");
  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice("bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

/**
 * Décide si une requête de cron peut déclencher la tâche.
 *
 * TROIS CAS, TROIS RÉPONSES DISTINCTES
 *   - pas de `CRON_SECRET` configuré → 503 : la route ne peut PAS être
 *     authentifiée, donc elle ne s'exécute pas (jamais de « si pas de secret,
 *     on laisse passer » — c'est la porte ouverte classique) ;
 *   - secret absent ou faux → 401 ;
 *   - secret correct → exécution.
 */
export function authorizeCronRequest(
  headers: Headers,
  env: { CRON_SECRET?: string | undefined } = {},
): CronAuthorization {
  const expected = env.CRON_SECRET;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      message:
        "CRON_SECRET n'est pas configuré sur ce serveur : la tâche ne peut pas être déclenchée à la main. " +
        "Définir CRON_SECRET dans l'environnement, puis appeler la route avec l'en-tête x-cron-secret.",
    };
  }

  const provided = readCronSecret(headers);
  if (!provided || !constantTimeSecretEquals(provided, expected)) {
    return { ok: false, status: 401, message: "Secret de cron absent ou invalide." };
  }

  return { ok: true };
}
