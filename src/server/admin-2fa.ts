import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/server/audit-log";
import {
  buildOtpAuthUri,
  deriveRecoveryCode,
  generateTotpSecret,
  TOTP_WINDOW_STEPS,
  verifyRecoveryCode,
  verifyTotpCode,
} from "@/server/totp";

/**
 * 2FA TOTP du back-office — enrôlement, confirmation, désactivation.
 *
 * Ce module ne contient que l'ORCHESTRATION EN BASE (Prisma + AuditLog) ; les
 * primitives cryptographiques et la politique de vérification d'un code vivent
 * dans `src/server/totp.ts`, qui reste pur (aucun accès DB, aucun `Date.now()`
 * implicite) — donc testable en unitaire sans base.
 *
 * LE POINT CRITIQUE DU MODÈLE DE DONNÉES : `totpSecret` est écrit dès le début
 * de l'enrôlement, mais `totpEnabledAt` seulement quand le PREMIER CODE a été
 * validé. Ces deux champs ne servent donc pas à la même chose :
 *   - `totpSecret` renseigné + `totpEnabledAt` nul → enrôlement EN COURS.
 *     La 2FA n'est pas active : l'utilisateur se connecte normalement, avec son
 *     mot de passe seul. C'est indispensable — l'utilisateur qui scanne le QR
 *     puis ferme l'onglet avant de saisir un code ne doit pas se retrouver
 *     devant un compte qu'il ne peut plus ouvrir (il n'a jamais prouvé qu'il
 *     savait produire un code).
 *   - `totpEnabledAt` renseigné → la 2FA est ACTIVE : sans code valide, pas de
 *     session (cf. la route de login).
 *
 * La 2FA reste OPTIONNELLE : un compte dont `totpEnabledAt` est nul suit le
 * chemin de connexion historique, sans modification de comportement.
 */

export type TwoFactorFailureCode =
  | "NOT_FOUND"
  | "ALREADY_ENABLED"
  | "NOT_ENABLED"
  | "INVALID_CODE";

export type TwoFactorFailure = {
  ok: false;
  code: TwoFactorFailureCode;
  message: string;
  status: number;
};

export type TwoFactorStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  /** Enrôlement commencé, premier code jamais validé. */
  pending: boolean;
  /**
   * Secret PENDING uniquement : tant que la 2FA n'est pas active, l'utilisateur
   * doit pouvoir reprendre un enrôlement abandonné (il a scanné le QR mais
   * fermé l'onglet) sans avoir à tout recommencer.
   */
  pendingSecret: string | null;
  pendingOtpAuthUri: string | null;
  /** Code de secours dérivé du secret, affiché à l'utilisateur (et à lui seul). */
  recoveryCode: string | null;
  /** Nom affiché dans l'application d'authentification. */
  issuer: string;
};

/** Nom de l'émetteur affiché dans l'app d'authentification. */
export function twoFactorIssuer(): string {
  return process.env.SHOP_NAME?.trim() || "Shop";
}

function otpAuthUriFor(secret: string, email: string): string {
  return buildOtpAuthUri({
    secret,
    accountName: email,
    issuer: twoFactorIssuer(),
  });
}

/** État 2FA d'un utilisateur, tel que la page /admin/security doit l'afficher. */
export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      totpSecret: true,
      totpEnabledAt: true,
    },
  });
  if (!user) return null;

  const enabled = user.totpEnabledAt !== null;
  const pending = !enabled && user.totpSecret !== null;

  return {
    enabled,
    enabledAt: user.totpEnabledAt,
    pending,
    pendingSecret: pending ? user.totpSecret : null,
    pendingOtpAuthUri: pending && user.totpSecret ? otpAuthUriFor(user.totpSecret, user.email) : null,
    recoveryCode: user.totpSecret ? deriveRecoveryCode(user.totpSecret) : null,
    issuer: twoFactorIssuer(),
  };
}

export type EnrollmentResult =
  | {
      ok: true;
      secret: string;
      otpAuthUri: string;
      recoveryCode: string;
      issuer: string;
    }
  | TwoFactorFailure;

/**
 * Démarre (ou recommence) un enrôlement : génère un secret, l'enregistre, et
 * renvoie de quoi configurer l'application mobile.
 *
 * Si la 2FA est DÉJÀ ACTIVE, on refuse : régénérer le secret derrière le dos de
 * l'utilisateur invaliderait son application d'authentification et le
 * verrouillerait dehors (il n'aurait plus aucun code valide). Il doit d'abord
 * désactiver avec un code.
 */
export async function startTotpEnrollment(params: {
  userId: string;
  now?: Date;
}): Promise<EnrollmentResult> {
  const now = params.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, totpSecret: true, totpEnabledAt: true },
  });
  if (!user) {
    return { ok: false, code: "NOT_FOUND", message: "Utilisateur introuvable", status: 404 };
  }
  if (user.totpEnabledAt !== null) {
    return {
      ok: false,
      code: "ALREADY_ENABLED",
      message: "La double authentification est déjà active. Désactivez-la d'abord pour changer d'appareil.",
      status: 409,
    };
  }

  const secret = generateTotpSecret();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      // `totpEnabledAt` reste nul : l'enrôlement n'est PAS une activation.
      data: { totpSecret: secret },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "user.2fa.enroll",
      entity: "User",
      entityId: user.id,
      // Le secret lui-même ne va PAS dans la piste d'audit.
      diff: { startedAt: now.toISOString() },
    });
  });

  return {
    ok: true,
    secret,
    otpAuthUri: otpAuthUriFor(secret, user.email),
    recoveryCode: deriveRecoveryCode(secret),
    issuer: twoFactorIssuer(),
  };
}

/**
 * Confirme l'enrôlement avec le premier code produit par l'application.
 * C'est CETTE étape qui active la 2FA (`totpEnabledAt`), pas le scan du QR.
 */
export async function confirmTotpEnrollment(params: {
  userId: string;
  code: string;
  now?: Date;
}): Promise<{ ok: true; enabledAt: Date } | TwoFactorFailure> {
  const now = params.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, totpSecret: true, totpEnabledAt: true },
  });
  if (!user) {
    return { ok: false, code: "NOT_FOUND", message: "Utilisateur introuvable", status: 404 };
  }
  if (user.totpEnabledAt !== null) {
    return { ok: false, code: "ALREADY_ENABLED", message: "La double authentification est déjà active.", status: 409 };
  }
  if (!user.totpSecret) {
    return {
      ok: false,
      code: "NOT_ENABLED",
      message: "Aucun enrôlement en cours. Commencez par générer un secret.",
      status: 409,
    };
  }

  const check = verifyTotpCode({
    secret: user.totpSecret,
    code: params.code,
    atMs: now.getTime(),
    window: TOTP_WINDOW_STEPS,
  });
  if (!check.valid) {
    return {
      ok: false,
      code: "INVALID_CODE",
      message: "Code invalide. Vérifiez l'heure de votre téléphone et le code affiché, puis réessayez.",
      status: 400,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: now },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "user.2fa.enable",
      entity: "User",
      entityId: user.id,
      diff: { enabledAt: now.toISOString() },
    });
  });

  return { ok: true, enabledAt: now };
}

/**
 * Désactive la 2FA. Exige un code valide (TOTP ou code de secours) : une
 * session volée ne suffit donc PAS à retirer le second facteur, c'est
 * exactement ce qu'on attend de lui. Le code de secours est le chemin de
 * secours pour l'utilisateur qui a perdu son téléphone.
 */
export async function disableTotp(params: {
  userId: string;
  code: string;
  now?: Date;
}): Promise<{ ok: true; method: "totp" | "recovery" } | TwoFactorFailure> {
  const now = params.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, totpSecret: true, totpEnabledAt: true },
  });
  if (!user) {
    return { ok: false, code: "NOT_FOUND", message: "Utilisateur introuvable", status: 404 };
  }
  if (user.totpEnabledAt === null || !user.totpSecret) {
    return {
      ok: false,
      code: "NOT_ENABLED",
      message: "La double authentification n'est pas active sur ce compte.",
      status: 409,
    };
  }

  const totp = verifyTotpCode({
    secret: user.totpSecret,
    code: params.code,
    atMs: now.getTime(),
    window: TOTP_WINDOW_STEPS,
  });
  const viaRecovery = totp.valid ? false : verifyRecoveryCode(user.totpSecret, params.code);
  if (!totp.valid && !viaRecovery) {
    return {
      ok: false,
      code: "INVALID_CODE",
      message: "Code invalide : la double authentification n'a pas été désactivée.",
      status: 400,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      // On efface le secret : le prochain enrôlement en générera un neuf, donc
      // l'ancien QR code ne pourra jamais être réutilisé.
      data: { totpSecret: null, totpEnabledAt: null },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "user.2fa.disable",
      entity: "User",
      entityId: user.id,
      diff: { disabledAt: now.toISOString(), method: totp.valid ? "totp" : "recovery" },
    });
  });

  return { ok: true, method: totp.valid ? "totp" : "recovery" };
}
