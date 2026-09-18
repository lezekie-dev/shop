import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  createCustomerSession,
  setCustomerCookieOnResponse,
} from "@/lib/customer-auth";
import {
  CUSTOMER_RATE_LIMIT_SCOPE,
  checkLoginRateLimit,
  clientIpFromHeaders,
  recordLoginAttempt,
} from "@/server/login-rate-limit";
import {
  CustomerAccountError,
  INVALID_CREDENTIALS_MESSAGE,
  verifyCustomerCredentials,
} from "@/server/customer-account";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(100),
});

/**
 * POST /api/account/login — connexion du client.
 *
 * Trois protections, dans cet ordre :
 *   1. plafond de tentatives (portée "customer" : le quota du back-office est
 *      un compteur séparé, on ne peut pas le consommer depuis ici)
 *   2. coût bcrypt payé même quand l'email est inconnu (pas d'énumération au
 *      chronomètre)
 *   3. message d'échec identique dans tous les cas d'échec
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email et mot de passe requis" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const ip = clientIpFromHeaders(req.headers);

  const verdict = await checkLoginRateLimit({
    identifier: email,
    ip,
    scope: CUSTOMER_RATE_LIMIT_SCOPE,
  });
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
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  let authenticated;
  try {
    authenticated = await verifyCustomerCredentials({ email, password });
  } catch (err) {
    if (err instanceof CustomerAccountError && err.code === "INVALID_CREDENTIALS") {
      await recordLoginAttempt({
        identifier: email,
        succeeded: false,
        ip,
        scope: CUSTOMER_RATE_LIMIT_SCOPE,
      });
      return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 });
    }
    throw err;
  }

  await recordLoginAttempt({
    identifier: email,
    succeeded: true,
    ip,
    scope: CUSTOMER_RATE_LIMIT_SCOPE,
  });

  const { token, expiresAt } = await createCustomerSession(authenticated.customerId);
  const res = NextResponse.json({
    ok: true,
    customer: {
      email: authenticated.email,
      firstName: authenticated.firstName,
      lastName: authenticated.lastName,
    },
  });
  setCustomerCookieOnResponse(res, token, expiresAt);
  return res;
}
