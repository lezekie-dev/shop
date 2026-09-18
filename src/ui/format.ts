/**
 * Formatage des dates pour le back-office.
 *
 * Toutes les pages admin sont rendues côté serveur : le fuseau utilisé est
 * celui du serveur, de façon cohérente, et il n'y a aucun risque de
 * divergence d'hydratation.
 */

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };
const DATE_ONLY: Intl.DateTimeFormatOptions = { dateStyle: "long" };

/** "18/09/2026 14:32" */
export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", DATE_TIME).format(toDate(date));
}

/** "18 septembre 2026" */
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", DATE_ONLY).format(toDate(date));
}

/** "lun. 15" — axe des mini-graphes 7 jours. */
export function formatDayShort(date: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" }).format(toDate(date));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Découpe un secret base32 en groupes de 4 (« JBSW Y3DP EHPK 3PXP »).
 *
 * Pourquoi ici et pas dans `src/server/totp.ts` : c'est de la PRÉSENTATION, et
 * un composant client ne peut pas importer le module TOTP (il traîne
 * `node:crypto`). La mise en forme vit donc dans la couche UI, où elle est
 * utilisable des deux côtés.
 */
export function formatTotpSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
