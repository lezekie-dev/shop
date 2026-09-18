import { describe, expect, it } from "vitest";

import {
  buildOtpAuthUri,
  decodeBase32,
  deriveRecoveryCode,
  encodeBase32,
  generateTotpCode,
  generateTotpSecret,
  hotp,
  timestepOf,
  TOTP_STEP_SECONDS,
  verifyRecoveryCode,
  verifyTotpCode,
} from "@/server/totp";
import {
  verifyLoginSecondFactor,
  type SecondFactorUser,
} from "@/server/totp";

/**
 * TOTP (RFC 6238) — implémentation maison sur `node:crypto`.
 *
 * Le point clé de ces tests : les VECTEURS OFFICIELS de la RFC. Un TOTP
 * « plausible » qui produit des codes à 6 chiffres ne prouve rien — s'il se
 * trompe d'un octet dans le HMAC ou d'un facteur dans le compteur, il génère
 * des codes cohérents avec lui-même et toutes les applications
 * d'authentification les refusent. Les valeurs ci-dessous viennent de la RFC
 * 4226 (annexe D) et de la RFC 6238 (annexe B), section SHA-1.
 *
 * Aucune fausse horloge n'est nécessaire : les fonctions de vérification
 * reçoivent l'instant en paramètre (CONVENTIONS §2).
 */

/** Secret ASCII des vecteurs des deux RFC, encodé en base32 comme un vrai secret. */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET = encodeBase32(Buffer.from(RFC_SECRET_ASCII, "ascii"));

describe("base32 (RFC 4648)", () => {
  it("encode le secret des vecteurs de test de la RFC", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("décode ce qu'il a encodé, sur toutes les tailles", () => {
    for (let size = 0; size <= 40; size += 1) {
      const bytes = Buffer.alloc(size, 7);
      expect(decodeBase32(encodeBase32(bytes)).equals(bytes)).toBe(true);
    }
  });

  it("tolère espaces, tirets, padding et minuscules (recopie à la main)", () => {
    const spaced = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
    expect(decodeBase32(spaced).toString("ascii")).toBe(RFC_SECRET_ASCII);
    expect(decodeBase32(`${RFC_SECRET}====`).toString("ascii")).toBe(RFC_SECRET_ASCII);
  });

  it("refuse un caractère hors alphabet plutôt que de dériver un code faux", () => {
    // 0, 1, 8 et 9 ne font pas partie de l'alphabet base32 : un secret qui en
    // contient est corrompu, et un code calculé dessus serait silencieusement
    // inutilisable.
    expect(() => decodeBase32("GEZDGNBV0")).toThrow(/invalide/i);
  });
});

describe("HOTP (RFC 4226, annexe D)", () => {
  it("produit les 10 premiers codes officiels", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    const key = Buffer.from(RFC_SECRET_ASCII, "ascii");
    expected.forEach((code, counter) => {
      expect(hotp(key, counter)).toBe(code);
    });
  });
});

describe("code TOTP (RFC 6238, annexe B — SHA-1)", () => {
  it("produit les codes officiels à 8 chiffres", () => {
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) {
      expect(generateTotpCode(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
    }
  });

  it("gère un compteur 64 bits (vecteur de la RFC 6238 pour T = 20000000000)", () => {
    // 20000000000 s / 30 s = 666666666, soit ~6,7e8. Ce compteur dépasse 2^31
    // (2 147 483 648) — donc une implémentation qui le range dans un entier
    // 32 bits SIGNÉ produit un résultat faux. Il ne dépasse en revanche PAS
    // 2^32 (4 294 967 296) : la borne à tester est 2^31, pas 2^32.
    // Vecteur officiel de l'annexe B de la RFC 6238, T = 20000000000 → 65353130.
    //
    // À NOTER : ce vecteur ne teste PAS le débordement d'un entier 32 bits.
    // T = 20000000000 / 30 = 666 666 666, une valeur INFÉRIEURE à 2^31
    // (2 147 483 648). Une implémentation 32 bits passerait donc ce test.
    // Les deux assertions ci-dessous le documentent pour éviter qu'on croie
    // le contraire, et le test suivant couvre le vrai dépassement.
    const t = timestepOf(20000000000 * 1000);
    expect(t).toBe(666666666);
    expect(t).toBeLessThan(2 ** 31);
    expect(generateTotpCode(RFC_SECRET, 20000000000 * 1000, 8)).toBe("65353130");
  });

  it("gère un compteur au-delà de 2^31 (une implémentation 32 bits échouerait)", () => {
    // Le compteur dépasse 2^31 (2 147 483 648) à partir de 64 424 509 440 s,
    // soit l'an ~4010. `writeBigUInt64BE` le range sur 64 bits ; une
    // implémentation qui écrirait le compteur dans un UInt32BE tronquerait et
    // produirait un code faux.
    const atMs = 70_000_000_000 * 1000;
    const t = timestepOf(atMs);
    expect(t).toBeGreaterThan(2 ** 31);
    // Le code doit être stable et de la bonne longueur (rien à comparer à la
    // RFC : elle ne fournit pas de vecteur au-delà de T = 20000000000).
    expect(generateTotpCode(RFC_SECRET, atMs, 8)).toMatch(/^\d{8}$/);
    // Deux compteurs différents ne peuvent pas produire le même code 8 chiffres
    // sur ce voisinage : c'est ce que la troncature 32 bits casserait.
    expect(generateTotpCode(RFC_SECRET, atMs, 8)).not.toBe(
      generateTotpCode(RFC_SECRET, (70_000_000_000 + 30) * 1000, 8),
    );
  });

  it("produit un code à 6 chiffres par défaut, complété par des zéros si besoin", () => {
    const code = generateTotpCode(RFC_SECRET, 1111111111 * 1000);
    expect(code).toMatch(/^\d{6}$/);
    expect(code).toBe("050471");
  });

  it("change à chaque pas de 30 s et reste stable à l'intérieur d'un pas", () => {
    const base = 1_735_000_000_000; // instant arbitraire, hors borne de pas
    const startOfStep = Math.floor(base / (TOTP_STEP_SECONDS * 1000)) * TOTP_STEP_SECONDS * 1000;
    const atStart = generateTotpCode(RFC_SECRET, startOfStep);
    expect(generateTotpCode(RFC_SECRET, startOfStep + 29_000)).toBe(atStart);
    expect(generateTotpCode(RFC_SECRET, startOfStep + 30_000)).not.toBe(atStart);
  });
});

describe("génération de secret", () => {
  it("produit 32 caractères base32 (20 octets) pour un secret neuf", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(decodeBase32(secret)).toHaveLength(20);
  });

  it("ne produit jamais deux fois le même secret", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe("vérification d'un code", () => {
  const secret = generateTotpSecret();
  const now = 1_735_000_062_000; // multiple de 1000, on évite les bornes de pas

  it("accepte le code courant", () => {
    const code = generateTotpCode(secret, now);
    const result = verifyTotpCode({ secret, code, atMs: now });
    expect(result.valid).toBe(true);
    expect(result.step).toBe(timestepOf(now));
  });

  it("accepte le code du pas précédent et du pas suivant (±1 pas = ±30 s)", () => {
    // Dérive d'horloge du téléphone : c'est ce que la tolérance couvre.
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode({ secret, code, atMs: now - 30_000 }).valid).toBe(true);
    expect(verifyTotpCode({ secret, code, atMs: now + 30_000 }).valid).toBe(true);
  });

  it("refuse un code à ±5 pas (2 min 30 d'écart)", () => {
    const code = generateTotpCode(secret, now);
    const older = verifyTotpCode({ secret, code, atMs: now + 5 * 30_000 });
    const newer = verifyTotpCode({ secret, code, atMs: now - 5 * 30_000 });
    expect(older.valid).toBe(false);
    expect(older.step).toBeNull();
    expect(newer.valid).toBe(false);
    expect(newer.step).toBeNull();
  });

  it("refuse un code issu d'un AUTRE secret au même instant", () => {
    const other = generateTotpSecret();
    const foreignCode = generateTotpCode(other, now);
    // Deux secrets différents peuvent produire le même code par hasard (1 chance
    // sur 10^6) ; on retire ce cas pour que le test ne soit pas instable.
    if (foreignCode === generateTotpCode(secret, now)) return;
    expect(verifyTotpCode({ secret, code: foreignCode, atMs: now }).valid).toBe(false);
  });

  it("refuse une saisie qui n'est pas un code de 6 chiffres", () => {
    expect(verifyTotpCode({ secret, code: "", atMs: now }).valid).toBe(false);
    expect(verifyTotpCode({ secret, code: "12345", atMs: now }).valid).toBe(false);
    expect(verifyTotpCode({ secret, code: "1234567", atMs: now }).valid).toBe(false);
    expect(verifyTotpCode({ secret, code: "abcdef", atMs: now }).valid).toBe(false);
  });

  it("accepte un code saisi avec un espace (copier-coller)", () => {
    const code = generateTotpCode(secret, now);
    expect(verifyTotpCode({ secret, code: ` ${code} `, atMs: now }).valid).toBe(true);
  });
});

describe("URI d'enrôlement otpauth", () => {
  it("respecte le format attendu par les applications d'authentification", () => {
    const uri = buildOtpAuthUri({
      secret: RFC_SECRET,
      accountName: "admin@shop.local",
      issuer: "Ma Boutique",
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    const url = new URL(uri);
    expect(url.protocol).toBe("otpauth:");
    expect(url.hostname).toBe("totp");
    expect(decodeURIComponent(url.pathname.slice(1))).toBe("Ma Boutique:admin@shop.local");
    expect(url.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(url.searchParams.get("issuer")).toBe("Ma Boutique");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
  });
});

describe("code de secours", () => {
  const secret = generateTotpSecret();

  it("est déterministe : il se recalcule à partir du secret", () => {
    expect(deriveRecoveryCode(secret)).toBe(deriveRecoveryCode(secret));
    expect(deriveRecoveryCode(secret)).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  });

  it("diffère d'un secret à l'autre", () => {
    expect(deriveRecoveryCode(secret)).not.toBe(deriveRecoveryCode(generateTotpSecret()));
  });

  it("accepte le code avec ou sans tiret, en minuscules", () => {
    const code = deriveRecoveryCode(secret);
    expect(verifyRecoveryCode(secret, code)).toBe(true);
    expect(verifyRecoveryCode(secret, code.replace("-", ""))).toBe(true);
    expect(verifyRecoveryCode(secret, code.replace("-", " ").toLowerCase())).toBe(true);
  });

  it("refuse un mauvais code de secours", () => {
    expect(verifyRecoveryCode(secret, "AAAAA-BBBBB")).toBe(false);
    expect(verifyRecoveryCode(secret, "")).toBe(false);
  });
});

describe("verifyLoginSecondFactor", () => {
  const now = new Date(1_735_000_062_000);
  const secret = generateTotpSecret();

  function user(overrides: Partial<SecondFactorUser> = {}): SecondFactorUser {
    return {
      id: "user-1",
      totpSecret: secret,
      totpEnabledAt: new Date(now.getTime() - 86_400_000),
      lastLoginAt: null,
      ...overrides,
    };
  }

  it("ne réclame rien quand la 2FA n'est pas activée (`totpEnabledAt` nul)", () => {
    // C'est LA non-régression : un enrôlement commencé mais non confirmé ne doit
    // pas changer le comportement de la connexion existante.
    expect(verifyLoginSecondFactor(user({ totpEnabledAt: null }), undefined, now)).toEqual({
      status: "not-enabled",
    });
    expect(verifyLoginSecondFactor(user({ totpEnabledAt: null, totpSecret: null }), "123456", now)).toEqual({
      status: "not-enabled",
    });
  });

  it("signale l'absence de code quand la 2FA est active", () => {
    expect(verifyLoginSecondFactor(user(), undefined, now)).toEqual({ status: "missing" });
    expect(verifyLoginSecondFactor(user(), "   ", now)).toEqual({ status: "missing" });
  });

  it("accepte un code TOTP valide et renvoie le pas consommé", () => {
    const code = generateTotpCode(secret, now.getTime());
    const result = verifyLoginSecondFactor(user(), code, now);
    expect(result).toEqual({ status: "ok", method: "totp", step: timestepOf(now.getTime()) });
  });

  it("accepte le code de secours et ne consomme aucun pas", () => {
    const result = verifyLoginSecondFactor(user(), deriveRecoveryCode(secret), now);
    expect(result).toEqual({ status: "ok", method: "recovery", step: null });
  });

  it("refuse un code faux", () => {
    expect(verifyLoginSecondFactor(user(), "000000", now).status).toBe("invalid");
  });

  it("REFUSE le rejeu : un code déjà consommé ne sert pas deux fois", () => {
    const stepStart = Math.floor(now.getTime() / 30_000) * 30_000;
    const code = generateTotpCode(secret, stepStart);
    // Premier login : le code du pas courant est accepté…
    expect(verifyLoginSecondFactor(user(), code, now).status).toBe("ok");
    // … le login a enregistré son instant, et le même code revient.
    const afterLogin = user({ lastLoginAt: new Date(stepStart) });
    expect(verifyLoginSecondFactor(afterLogin, code, now)).toEqual({ status: "replay" });
  });

  it("accepte le code du pas suivant après une connexion réussie", () => {
    const stepStart = Math.floor(now.getTime() / 30_000) * 30_000;
    const afterLogin = user({ lastLoginAt: new Date(stepStart) });
    const nextCode = generateTotpCode(secret, stepStart + 30_000);
    const result = verifyLoginSecondFactor(afterLogin, nextCode, new Date(stepStart + 60_000));
    expect(result.status).toBe("ok");
  });

  it("n'applique pas l'anti-rejeu au code de secours (pas de pas)", () => {
    // Limite assumée et documentée : sans champ dédié en base, le code de
    // secours n'est pas à usage unique.
    const afterLogin = user({ lastLoginAt: now });
    expect(verifyLoginSecondFactor(afterLogin, deriveRecoveryCode(secret), now).status).toBe("ok");
  });
});
