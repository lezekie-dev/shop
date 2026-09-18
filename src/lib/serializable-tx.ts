import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/**
 * Transaction `Serializable` avec retry borné — CONVENTIONS §12.
 *
 * ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────
 * Une transaction qui LIT un compteur puis ÉCRIT une ligne dépendante (compter
 * les usages d'un code promo, puis en créer une) est exposée au « write skew » :
 * en Read Committed, deux checkouts simultanés lisent tous les deux « 0 usage »
 * et créent chacun leur remise. Le code `maxRedemptions = 1` est alors consommé
 * deux fois — c'est exactement la fuite de marge invisible du risque R4, et
 * elle ne se voit dans aucun test de bout en bout séquentiel.
 *
 * `Serializable` fait échouer la seconde transaction au commit (PostgreSQL
 * `40001`, exposé par Prisma en `P2034`). Sans retry, on remplace une double
 * remise silencieuse par un 500 visible : le retry est donc OBLIGATOIRE, il
 * rejoue la transaction sur des données à jour.
 *
 * Paramètres (§12) : 3 tentatives, backoff 50 ms puis 150 ms, et retry
 * UNIQUEMENT sur un conflit de sérialisation. Une erreur `P2002` (contrainte
 * unique) doit remonter immédiatement : c'est un bug ou une double soumission,
 * pas un conflit de concurrence.
 *
 * ⚠ `Prisma.PrismaClientKnownRequestError` avec `code === "P2034"` est la forme
 * que Prisma 5 prend pour un `40001` — c'est aussi ce que teste
 * `src/server/admin-users.ts`. On accepte en plus un `40001` reconnu dans le
 * message, au cas où le driver remonterait l'erreur brute.
 */
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts?: { maxAttempts?: number; backoffMs?: readonly number[] },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const backoffMs = opts?.backoffMs ?? [50, 150];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
    } catch (err) {
      if (!isSerializationFailure(err) || attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt - 1] ?? 50));
    }
  }

  /* istanbul ignore next — la boucle sort toujours par `return` ou `throw`. */
  throw new Error("withSerializableRetry : sortie de boucle impossible");
}

/** `true` seulement pour un conflit de sérialisation PostgreSQL (40001). */
export function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
    return true;
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return /SQLSTATE 40001|40001/.test(String(err.message));
  }
  return false;
}
