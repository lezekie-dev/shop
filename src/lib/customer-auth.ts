import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Authentification du CLIENT de la boutique (par opposition à `src/lib/auth.ts`,
 * qui gère les utilisateurs internes du back-office).
 *
 * DEUX sessions coexistent et ne doivent JAMAIS se confondre :
 *   - admin : table `Session`      + cookie d'env `SESSION_COOKIE_NAME`
 *   - client : table `CustomerSession` + cookie `customer_session`
 *
 * Le nom du cookie client est figé ici, et non lu depuis l'env : c'est
 * précisément le point où une confusion se paierait cher. Si les deux espaces
 * partageaient le même nom, poser un cookie client écraserait la session admin
 * ouverte dans le même navigateur — et un jeton client présenté au back-office
 * serait lu dans la table `Session`… où il n'existe pas. Deux tables, deux
 * noms : la confusion devient structurellement impossible. (En tirer une
 * variable d'env demanderait un ADR, cf. CONVENTIONS §9.)
 */
export const CUSTOMER_SESSION_COOKIE = "customer_session";

/**
 * Durée de session client : 30 jours.
 *
 * Volontairement plus longue que le TTL admin (env `SESSION_TTL_HOURS`, 24 h) :
 * un client qui doit retaper son mot de passe à chaque visite ne revient pas.
 * Ce n'est pas un affaiblissement — le cookie reste httpOnly et la session
 * reste révocable en base (déconnexion, suppression de la ligne).
 */
const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type CustomerIdentity = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};

export type CustomerSessionWithIdentity = {
  session: { id: string; token: string; expiresAt: Date };
  customer: CustomerIdentity;
};

/** Jeton de session : 256 bits d'aléa cryptographique, comme la session admin. */
function generateSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function cookieOptions(expiresAt: Date): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  };
}

function toIdentity(customer: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}): CustomerIdentity {
  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
  };
}

/**
 * Ouvre une session client. Le mot de passe n'est jamais stocké ici : un
 * changement de mot de passe n'invalide donc pas les sessions ouvertes — la
 * seule révocation prévue au MVP est la déconnexion (suppression de la ligne).
 */
export async function createCustomerSession(
  customerId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
  await prisma.customerSession.create({ data: { token, customerId, expiresAt } });
  return { token, expiresAt };
}

export function setCustomerCookieOnResponse(
  res: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  res.cookies.set(CUSTOMER_SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export function clearCustomerCookieOnResponse(res: NextResponse): void {
  res.cookies.set(CUSTOMER_SESSION_COOKIE, "", {
    ...cookieOptions(new Date(0)),
    maxAge: 0,
  });
}

/** Pour les Server Components / Server Actions, qui passent par `next/headers`. */
export function setCustomerCookie(token: string, expiresAt: Date): void {
  cookies().set(CUSTOMER_SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export function clearCustomerCookie(): void {
  cookies().set(CUSTOMER_SESSION_COOKIE, "", {
    ...cookieOptions(new Date(0)),
    maxAge: 0,
  });
}

/** Lit la session client depuis le cookie d'une `NextRequest` (route handlers). */
export async function getCustomerSessionFromRequest(
  req: NextRequest,
): Promise<CustomerSessionWithIdentity | null> {
  const token = req.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return null;
  return findCustomerSession(token);
}

/** Lit la session client depuis `cookies()` (Server Components). */
export async function getCustomerSessionFromCookie(): Promise<CustomerSessionWithIdentity | null> {
  const token = cookies().get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return null;
  return findCustomerSession(token);
}

/** Identité du client connecté, ou `null` (visiteur anonyme). */
export async function getCurrentCustomer(): Promise<CustomerIdentity | null> {
  const found = await getCustomerSessionFromCookie();
  return found?.customer ?? null;
}

/**
 * Garde des pages `/compte/*`.
 *
 * Redirige vers la connexion plutôt que de rendre une page vide : l'URL
 * demandée est conservée dans `?next=` pour ramener le client là où il allait.
 *
 * Cette vérification est faite ICI, côté Node, avec accès à la base — et non
 * dans le middleware Edge, qui ne verrait que la présence d'un cookie sans
 * pouvoir valider sa révocation (cf. CONVENTIONS §11).
 */
export async function requireCustomer(nextPath?: string): Promise<CustomerIdentity> {
  const customer = await getCurrentCustomer();
  if (!customer) {
    const query = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/compte/connexion${query}`);
  }
  return customer;
}

/**
 * Garde des route handlers `/api/account/**`.
 *
 * Renvoie `null` au lieu de rediriger : un `fetch` doit recevoir un 401 JSON,
 * pas une page HTML de connexion.
 */
export async function requireCustomerApi(
  req: NextRequest,
): Promise<CustomerIdentity | null> {
  const found = await getCustomerSessionFromRequest(req);
  return found?.customer ?? null;
}

async function findCustomerSession(
  token: string,
): Promise<CustomerSessionWithIdentity | null> {
  const session = await prisma.customerSession.findUnique({
    where: { token },
    include: { customer: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    // Nettoyage opportuniste : une session expirée qui traîne reste un jeton
    // valable pour qui la volerait, alors qu'elle ne sert plus à personne.
    await prisma.customerSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    session: { id: session.id, token: session.token, expiresAt: session.expiresAt },
    customer: toIdentity(session.customer),
  };
}

/** Révoque une session (déconnexion). Sans effet si le jeton est inconnu. */
export async function deleteCustomerSessionByToken(token: string): Promise<void> {
  await prisma.customerSession.deleteMany({ where: { token } });
}
