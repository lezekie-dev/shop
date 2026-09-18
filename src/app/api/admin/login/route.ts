import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import {
  createSession,
  setSessionCookieOnResponse,
  verifyPassword,
} from "@/lib/auth";
import { verifyLoginSecondFactor } from "@/server/totp";
import {
  checkLoginRateLimit,
  clientIpFromHeaders,
  recordLoginAttempt,
} from "@/server/login-rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /**
   * Code TOTP (6 chiffres) ou code de secours, quand la 2FA est active.
   * Optionnel : un compte sans 2FA (`totpEnabledAt` nul) ne l'envoie jamais.
   */
  totpCode: z.string().trim().max(64).optional(),
});

/**
 * POST /api/admin/login
 *
 * Le mot de passe admin est la SEULE barrière du back-office : il ouvre toutes
 * les commandes, donc les coordonnées de tous les clients. Trois protections :
 *   1. rate limiting par email ET par IP (cf. login-rate-limit.ts)
 *   2. réponse identique pour « compte inconnu » et « mauvais mot de passe »,
 *      avec un hash bidon comparé dans le premier cas pour garder un temps de
 *      réponse comparable (sinon on énumère les comptes existants au chrono).
 *   3. second facteur TOTP quand le compte l'a activé — vérifié APRÈS le mot
 *      de passe (sinon on offrirait un oracle pour savoir qui a la 2FA).
 *
 * Le code TOTP est demandé dans le MÊME appel que le mot de passe : il n'y a
 * donc aucun état intermédiaire « moitié authentifié » à stocker, ni jeton de
 * challenge à faire expirer. Le client renvoie une seconde fois le formulaire
 * (les champs restent remplis) après avoir lu son application.
 *
 * Un échec de second facteur compte comme un échec de connexion : tenter
 * 1 000 codes à 6 chiffres doit être aussi coûteux que tester 1 000 mots de
 * passe, et bloqué par les mêmes compteurs.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email et mot de passe requis" },
      { status: 400 },
    );
  }
  const { password, totpCode } = parsed.data;
  // Le stockage est en minuscules : on cherche la même forme que celle écrite
  // à la création, sinon « Admin@Shop.Local » ne trouverait aucun compte.
  const email = normalizeEmail(parsed.data.email);
  const ip = clientIpFromHeaders(req.headers);

  // 1. Plafond atteint ? On refuse AVANT de comparer le mot de passe : inutile
  //    de payer le coût bcrypt (volontairement lent) pour un essai qui ne
  //    compte pas, et c'est ce coût qui rend le bruteforce cher.
  const verdict = await checkLoginRateLimit({ identifier: email, ip });
  if (!verdict.allowed) {
    const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error:
          verdict.scope === "identifier"
            ? `Trop de tentatives pour ce compte. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`
            : `Trop de tentatives depuis cette adresse. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
        code: "RATE_LIMITED",
        retryAfterSeconds: verdict.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(verdict.retryAfterSeconds) },
      },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Compare contre un hash bidon pour conserver un timing comparable.
    await verifyPassword(password, "$2a$12$abcdefghijklmnopqrstuv");
    await recordLoginAttempt({ identifier: email, succeeded: false, ip });
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await recordLoginAttempt({ identifier: email, succeeded: false, ip });
    return NextResponse.json({ error: "Identifiants invalides" }, { status: 401 });
  }

  // 2. Compte désactivé. Le refus est APRÈS la vérification du mot de passe :
  //    quelqu'un qui ignore le mot de passe lit « identifiants invalides », donc
  //    la désactivation d'un compte n'est pas une information publique.
  //    On ne supprime jamais l'utilisateur (son historique d'audit reste
  //    attaché) : c'est ce refus qui applique la fermeture, avec la
  //    suppression des sessions en cours côté gestion des utilisateurs.
  if (!user.active) {
    await recordLoginAttempt({ identifier: email, succeeded: false, ip });
    return NextResponse.json(
      {
        error: "Ce compte est désactivé. Contactez un administrateur.",
        code: "ACCOUNT_DISABLED",
      },
      { status: 403 },
    );
  }

  // 3. Second facteur, uniquement si le compte l'a ACTIVÉ (totpEnabledAt non
  //    nul). Un enrôlement commencé mais non confirmé ne bloque donc rien.
  const secondFactor = verifyLoginSecondFactor(user, totpCode, new Date());
  if (secondFactor.status === "missing") {
    // Pas de compteur incrémenté ici : ce n'est pas une tentative de code, mais
    // un formulaire qui n'en contenait pas encore (le client demande le code
    // après avoir appris que le compte en a un).
    return NextResponse.json(
      {
        error: "Ce compte est protégé par une double authentification.",
        code: "TOTP_REQUIRED",
      },
      { status: 401 },
    );
  }
  if (secondFactor.status === "invalid" || secondFactor.status === "replay") {
    await recordLoginAttempt({ identifier: email, succeeded: false, ip });
    return NextResponse.json(
      {
        error:
          secondFactor.status === "replay"
            ? "Code déjà utilisé. Attendez le code suivant dans votre application."
            : "Code de vérification invalide.",
        code: secondFactor.status === "replay" ? "TOTP_REPLAY" : "TOTP_INVALID",
      },
      { status: 401 },
    );
  }

  // Succès : efface les échecs précédents pour ce compte.
  await recordLoginAttempt({ identifier: email, succeeded: true, ip });

  // `lastLoginAt` sert deux fins : l'affichage « dernière connexion » dans la
  // gestion des utilisateurs, et le repère anti-rejeu du code TOTP
  // (cf. verifyLoginSecondFactor). On l'écrit donc à chaque connexion réussie.
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({
    ok: true,
    role: user.role,
    secondFactor: secondFactor.status === "ok" ? secondFactor.method : null,
  });
  setSessionCookieOnResponse(res, token, expiresAt);
  return res;
}
