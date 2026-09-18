import crypto from "node:crypto";

/**
 * TOTP (RFC 6238) — implémenté sur `node:crypto`, SANS dépendance npm.
 *
 * POURQUOI PAS `otplib` NI `speakeasy` : TOTP n'est que du HMAC-SHA1 sur un
 * compteur + un encodage base32, soit ~60 lignes vérifiables. Ajouter une
 * dépendance ici élargit la surface d'attaque (c'est du code qui manipule le
 * secret de 2FA) et le lockfile, pour une primitive que Node fournit déjà
 * (`crypto.createHmac`). Le projet n'embarque donc aucune lib TOTP.
 *
 * CONVENTIONS §2 : tout ce qui dépend de l'horloge la reçoit en paramètre
 * (`atMs`) et n'appelle jamais `Date.now()` — les tests n'ont alors besoin
 * d'aucune fausse horloge et restent déterministes (y compris les vecteurs de
 * test de la RFC 6238, datés de 1970 à 2603).
 */

/** Pas de temps TOTP : 30 s (RFC 6238 §5.2, valeur de tous les authenticators). */
export const TOTP_STEP_SECONDS = 30;
/** Nombre de chiffres par défaut (aligné sur Google Authenticator / Authy). */
export const TOTP_DIGITS = 6;
/**
 * Tolérance : ±1 pas, soit ±30 s.
 *
 * POURQUOI PAS 0 : l'horloge du téléphone dérive. Un serveur strict à 0 pas
 * rejette des codes légitimes dès qu'un appareil a 20 s de retard — et
 * l'utilisateur n'a aucun moyen de le savoir. POURQUOI PAS ±5 : chaque pas
 * supplémentaire est une fenêtre de rejeu supplémentaire pour un code
 * intercepté (le nombre de codes simultanément valides passe de 1 à 2n+1).
 * ±1 est le compromis standard.
 */
export const TOTP_WINDOW_STEPS = 1;
/** 160 bits de secret : la taille recommandée par la RFC 4226 §4 pour HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Accès borné à un tableau/buffer.
 *
 * `noUncheckedIndexedAccess` (CONVENTIONS §7) impose de traiter tout `buffer[i]`
 * comme potentiellement `undefined`. Les index utilisés ici sont produits par
 * construction (modulo 32 pour le base32, offsets fixés par la RFC 4226 pour le
 * HMAC) : l'exception ne peut donc signaler qu'un bug interne, jamais une
 * entrée utilisateur — et on préfère un échec bruyant à un `?? 0` qui
 * fabriquerait un code faux en silence.
 */
function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`Index hors bornes dans un calcul TOTP : ${index}`);
  }
  return value;
}

/** Encode un buffer en base32 RFC 4648 sans padding (« AAAAAAAA… »). */
export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = at(buffer, i);
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Décode du base32 en buffer.
 *
 * Tolérant par construction : on ignore espaces, tirets, padding `=` et la
 * casse. Un utilisateur qui recopie son secret depuis un écran, ou qui le
 * colle avec les espaces de mise en forme, doit fonctionner — refuser pour un
 * espace serait un bug d'ergonomie, pas une protection.
 *
 * @throws Error si un caractère hors alphabet est présent (secret corrompu :
 *         on préfère échouer bruyamment plutôt que de dériver un code faux).
 */
export function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Secret base32 invalide : caractère « ${char} » inconnu`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Génère un secret TOTP neuf (20 octets aléatoires, encodés en base32).
 * `randomBytes` est injectable pour les tests d'idempotence.
 */
export function generateTotpSecret(randomBytes: (size: number) => Buffer = crypto.randomBytes): string {
  return encodeBase32(randomBytes(TOTP_SECRET_BYTES));
}

/** Numéro de pas (compteur HOTP) d'un instant donné. */
export function timestepOf(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * HOTP (RFC 4226) : HMAC-SHA1 du compteur, troncature dynamique, modulo 10^digits.
 */
export function hotp(key: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  // Le compteur est un entier 64 bits big-endian. On l'écrit en deux fois :
  // `writeUInt32BE` refuse un nombre > 2^32-1, et un compteur TOTP dépasse
  // cette borne à partir de l'an 5855 (et les vecteurs de test de la RFC 6238
  // utilisent déjà 20000000000 s, soit un compteur > 2^32).
  message.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac("sha1", key).update(message).digest();
  // Troncature dynamique : les 4 bits de poids faible du dernier octet donnent
  // l'offset où lire 31 bits — les 8 codes authentiques ne dépendent ainsi que
  // d'une partie du HMAC, sans biais modulo.
  const offset = at(digest, digest.length - 1) & 0x0f;
  const binary =
    ((at(digest, offset) & 0x7f) << 24) |
    ((at(digest, offset + 1) & 0xff) << 16) |
    ((at(digest, offset + 2) & 0xff) << 8) |
    (at(digest, offset + 3) & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Code TOTP à un instant donné. `atMs` en millisecondes epoch. */
export function generateTotpCode(
  secret: string,
  atMs: number,
  digits: number = TOTP_DIGITS,
): string {
  return hotp(decodeBase32(secret), timestepOf(atMs), digits);
}

/** Normalise un code saisi : espaces retirés, majuscules (le code de secours
 * contient des lettres). Utilisé avant toute comparaison. */
export function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/** Comparaison à temps constant : un `===` sur un code laisse fuiter, par le
 * temps de réponse, le nombre de caractères corrects en tête. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export type TotpVerification = {
  valid: boolean;
  /**
   * Pas (compteur absolu) du code validé, `null` si aucun code ne correspond.
   * Il est renvoyé pour permettre la détection de REJEU côté appelant : deux
   * présentations du même pas sont deux usages du même code.
   */
  step: number | null;
};

/**
 * Vérifie un code TOTP avec une fenêtre de tolérance de ±`window` pas.
 *
 * On parcourt les `2n+1` pas candidats et on compare chaque code produit à
 * temps constant. Aucun `break` anticipé sur la comparaison : on garde le tour
 * complet pour que la durée de vérification ne dépende pas du pas qui matche.
 */
export function verifyTotpCode(params: {
  secret: string;
  code: string;
  atMs: number;
  window?: number;
  digits?: number;
}): TotpVerification {
  const window = params.window ?? TOTP_WINDOW_STEPS;
  const digits = params.digits ?? TOTP_DIGITS;
  const submitted = normalizeCode(params.code);
  if (submitted.length !== digits || !/^\d+$/.test(submitted)) {
    return { valid: false, step: null };
  }

  const key = decodeBase32(params.secret);
  const current = timestepOf(params.atMs);
  let matchedStep: number | null = null;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidateStep = current + offset;
    if (candidateStep < 0) continue;
    const expected = hotp(key, candidateStep, digits);
    if (timingSafeEqualStrings(expected, submitted) && matchedStep === null) {
      matchedStep = candidateStep;
    }
  }

  return { valid: matchedStep !== null, step: matchedStep };
}

/**
 * URI d'enrôlement `otpauth://` (format standard Google Authenticator).
 *
 * C'est LE format attendu par tous les authenticators : c'est lui qu'une
 * application mobile scanne (ou dans lequel elle lit le secret à la main).
 * `issuer` (le nom de la boutique) est répété en préfixe du label du compte
 * parce que les clients l'affichent de deux façons différentes selon leur
 * version ; l'omettre donne des entrées « Compte » indistinguables entre
 * plusieurs services.
 */
export function buildOtpAuthUri(params: {
  secret: string;
  accountName: string;
  issuer: string;
  digits?: number;
  periodSeconds?: number;
}): string {
  const digits = params.digits ?? TOTP_DIGITS;
  const period = params.periodSeconds ?? TOTP_STEP_SECONDS;
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(period),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * Code de secours, DÉRIVÉ du secret TOTP (HMAC du secret avec un label fixe).
 *
 * POURQUOI DÉRIVÉ ET NON ALÉATOIRE : le schéma Prisma ne possède aucun champ
 * pour stocker des codes de secours (une seule colonne `totpSecret`), et la
 * migration est hors de mon périmètre. Un code dérivé se recalcule à tout
 * moment à partir du secret, donc il ne peut pas être perdu : l'utilisateur qui
 * perd son téléphone retrouve son code de secours dans /admin/security.
 *
 * LIMITE ASSUMÉE ET DOCUMENTÉE : ce code n'est PAS à usage unique (le rendre
 * à usage unique exigerait de le marquer consommé en base → champ dédié + ADR,
 * cf. CONVENTIONS §9). Il doit donc être traité comme un second mot de passe :
 * stocké nulle part ailleurs, et sa fuite se répare en ré-enrôlant la 2FA —
 * exactement comme la fuite du secret.
 */
export function deriveRecoveryCode(secret: string): string {
  const digest = crypto
    .createHmac("sha1", decodeBase32(secret))
    .update("shop-admin-recovery-code-v1")
    .digest();
  const encoded = encodeBase32(digest).slice(0, 10);
  return `${encoded.slice(0, 5)}-${encoded.slice(5, 10)}`;
}

/** Vérifie un code de secours (tirets, espaces et casse ignorés). */
export function verifyRecoveryCode(secret: string, submitted: string): boolean {
  // On normalise LES DEUX côtés : le code dérivé est affiché avec un tiret
  // (« N4XSR-NJR3M ») alors que l'utilisateur peut le recopier avec un espace
  // ou sans séparateur du tout.
  return timingSafeEqualStrings(
    normalizeCode(deriveRecoveryCode(secret)),
    normalizeCode(submitted),
  );
}

/**
 * État minimal de l'utilisateur pour vérifier son second facteur à la connexion.
 * Volontairement réduit aux champs utiles : la politique ne doit pas pouvoir
 * lire autre chose du compte.
 */
export type SecondFactorUser = {
  id: string;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  /** Sert de repère anti-rejeu (cf. `verifyLoginSecondFactor`). */
  lastLoginAt: Date | null;
};

export type SecondFactorOutcome =
  | { status: "not-enabled" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "replay" }
  | { status: "ok"; method: "totp" | "recovery"; step: number | null };

/**
 * Vérifie le second facteur d'une connexion. FONCTION PURE (aucune DB, aucun
 * `Date.now()`) : elle reçoit l'état de l'utilisateur et l'heure, ce qui la rend
 * testable en UNITAIRE, sans mock, sans fausse horloge et sans base.
 *
 * ANTI-REJEU : un code TOTP est valide pendant tout un pas de 30 s (et pendant
 * 3 pas avec notre tolérance ±1). Un code intercepté — regard par-dessus
 * l'épaule, proxy, historique de saisie — reste donc rejouable tant que la
 * fenêtre est ouverte. On refuse tout code dont le PAS est antérieur ou égal au
 * pas du dernier login réussi : `lastLoginAt` est le seul repère monotone dont
 * on dispose par utilisateur sans ajouter de colonne au schéma.
 *
 * CONSÉQUENCE ASSUMÉE : après une connexion, il faut attendre le pas suivant
 * (≤ 30 s) pour se reconnecter, puisque le code courant a déjà été consommé.
 * C'est le prix d'un anti-rejeu sans état supplémentaire en base.
 *
 * Le code de secours, lui, n'est PAS à usage unique (voir `deriveRecoveryCode`) :
 * il ne participe donc pas au contrôle de rejeu, et il n'a pas de `step`.
 */
export function verifyLoginSecondFactor(
  user: SecondFactorUser,
  code: string | undefined | null,
  now: Date,
): SecondFactorOutcome {
  if (!user.totpEnabledAt || !user.totpSecret) return { status: "not-enabled" };
  const submitted = code?.trim();
  if (!submitted) return { status: "missing" };

  const totp = verifyTotpCode({
    secret: user.totpSecret,
    code: submitted,
    atMs: now.getTime(),
    window: TOTP_WINDOW_STEPS,
  });

  if (totp.valid && totp.step !== null) {
    if (user.lastLoginAt && totp.step <= timestepOf(user.lastLoginAt.getTime())) {
      return { status: "replay" };
    }
    return { status: "ok", method: "totp", step: totp.step };
  }

  if (verifyRecoveryCode(user.totpSecret, submitted)) {
    return { status: "ok", method: "recovery", step: null };
  }

  return { status: "invalid" };
}
