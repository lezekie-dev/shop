import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSession,
  setSessionCookieOnResponse,
  verifyPassword,
} from "@/lib/auth";
import {
  checkLoginRateLimit,
  clientIpFromHeaders,
  recordLoginAttempt,
} from "@/server/login-rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/admin/login
 *
 * Le mot de passe admin est la SEULE barrière du back-office : il ouvre toutes
 * les commandes, donc les coordonnées de tous les clients. Deux protections :
 *   1. rate limiting par email ET par IP (cf. login-rate-limit.ts)
 *   2. réponse identique pour « compte inconnu » et « mauvais mot de passe »,
 *      avec un hash bidon comparé dans le premier cas pour garder un temps de
 *      réponse comparable (sinon on énumère les comptes existants au chrono).
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
  const { email, password } = parsed.data;
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

  // Succès : efface les échecs précédents pour ce compte.
  await recordLoginAttempt({ identifier: email, succeeded: true, ip });

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ ok: true });
  setSessionCookieOnResponse(res, token, expiresAt);
  return res;
}
