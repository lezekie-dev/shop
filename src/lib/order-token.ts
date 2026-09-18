import { randomBytes } from "node:crypto";

/**
 * Jeton d'accès à une commande — utilisé par le code applicatif ET les tests.
 *
 * 32 octets d'aléa cryptographique (256 bits) encodés en hexadécimal, soit
 * 64 caractères. Le client consulte sa commande via ce jeton, jamais via l'id
 * technique : un cuid est unique mais reste un identifiant interne qu'il ne
 * faut pas traiter comme un secret (il transite dans les logs admin, les
 * exports, les URLs de back-office).
 *
 * `randomBytes` (CSPRNG) et non `Math.random` : ce jeton est la seule barrière
 * entre les coordonnées d'un client et un visiteur anonyme.
 */
export function generateOrderAccessToken(): string {
  return randomBytes(32).toString("hex");
}

/** Format attendu d'un jeton : 64 caractères hexadécimaux. */
export const ORDER_ACCESS_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** true si la chaîne a la forme d'un jeton d'accès (pas de validation d'existence). */
export function looksLikeOrderAccessToken(value: unknown): boolean {
  return typeof value === "string" && ORDER_ACCESS_TOKEN_PATTERN.test(value);
}
