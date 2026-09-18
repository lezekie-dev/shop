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
  REGISTRATION_REFUSED_MESSAGE,
  registerCustomerAccount,
} from "@/server/customer-account";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().email("Email invalide").max(200),
  // 8 caractères minimum : c'est la seule barrière du compte client. 100 max
  // pour borner le coût bcrypt — bcrypt ignore tout ce qui dépasse 72 octets,
  // donc accepter des kilo-octets ne protégerait rien de plus.
  password: z.string().min(8, "8 caractères minimum").max(100),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(40).optional(),
});

/**
 * POST /api/account/register — création de compte client.
 *
 * Trois cas, un seul succès visible :
 *   1. email inconnu → compte créé
 *   2. email d'un client INVITÉ (passwordHash nul) → le compte est rattaché à la
 *      ligne existante, l'historique de commandes est conservé
 *   3. email ayant déjà un mot de passe → refus, message générique, hash intact
 *
 * La réponse ne dit JAMAIS au client dans quel cas il se trouvait (le champ
 * interne `attachedToGuestAccount` n'est pas exposé) : le renvoyer permettrait
 * de découvrir qu'un email a déjà commandé ici, donc d'énumérer la base clients.
 *
 * Connexion immédiate après création : le mot de passe vient d'être saisi, il
 * serait absurde de le redemander sur la page suivante.
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
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { email, password, firstName, lastName, phone } = parsed.data;
  const ip = clientIpFromHeaders(req.headers);

  // Le plafond est partagé avec la connexion (même portée, même identifiant) :
  // sans lui, l'inscription devient un oracle d'énumération gratuit à rejouer
  // en boucle, alors que la connexion, elle, est protégée.
  const verdict = await checkLoginRateLimit({
    identifier: email,
    ip,
    scope: CUSTOMER_RATE_LIMIT_SCOPE,
  });
  if (!verdict.allowed) {
    const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
    return NextResponse.json(
      {
        error: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.`,
        code: "RATE_LIMITED",
        retryAfterSeconds: verdict.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  let result;
  try {
    result = await registerCustomerAccount({
      email,
      password,
      firstName,
      lastName,
      ...(phone === undefined ? {} : { phone }),
    });
  } catch (err) {
    if (err instanceof CustomerAccountError) {
      await recordLoginAttempt({
        identifier: email,
        succeeded: false,
        ip,
        scope: CUSTOMER_RATE_LIMIT_SCOPE,
      });
      return NextResponse.json(
        { error: REGISTRATION_REFUSED_MESSAGE, code: err.code },
        { status: 409 },
      );
    }
    throw err;
  }

  // Une inscription aboutie remet le compteur d'échecs à zéro pour cet email.
  await recordLoginAttempt({
    identifier: email,
    succeeded: true,
    ip,
    scope: CUSTOMER_RATE_LIMIT_SCOPE,
  });

  const { token, expiresAt } = await createCustomerSession(result.customerId);
  const res = NextResponse.json(
    { ok: true, customer: { email: result.email, firstName, lastName } },
    { status: 201 },
  );
  setCustomerCookieOnResponse(res, token, expiresAt);
  return res;
}
