import { createId } from "@paralleldrive/cuid2";

/**
 * Generate a CUID2 — non-enumerable, URL-safe, collision-resistant id.
 * Used for app-side ids (e.g. cart session keys, external references).
 * Prisma `@default(cuid())` uses cuid v1 internally for row ids; that is fine.
 */
export function newId(): string {
  return createId();
}
