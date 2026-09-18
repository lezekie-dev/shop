import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@prisma/client";

import {
  can,
  canAll,
  capabilitiesFor,
  type Capability,
} from "@/domain/access";
import { clearSessionCookie, clearSessionCookieOnResponse, getSessionFromCookie, getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Gardes d'autorisation du back-office.
 *
 * POURQUOI CE FICHIER EXISTE À CÔTÉ DE `src/lib/auth.ts` :
 * `lib/auth.ts` répond à « es-tu connecté ? » (`requireAdmin`, `requireAdminApi`)
 * et il est partagé avec l'espace client ; ce module-ci répond à « as-tu LE
 * DROIT ? » et porte la politique de rôles (§13 des CONVENTIONS). Le séparer
 * évite de toucher au fichier d'auth pendant que d'autres chantiers le
 * modifient, et donne un seul point à auditer pour l'autorisation.
 *
 * DEUX DÉCISIONS STRUCTURANTES :
 *
 * 1. On NE fait PAS confiance au rôle porté par la session pour autoriser.
 *    La session a été créée au moment du login ; entre-temps un administrateur
 *    a pu rétrograder l'utilisateur ou désactiver son compte. On relit donc
 *    `role` et `active` en base à chaque requête (une requête indexée par clé
 *    primaire, négligeable devant le rendu d'une page admin). Sans cette
 *    relecture, une rétrogradation ne prendrait effet qu'à l'expiration du
 *    cookie (jusqu'à SESSION_TTL_HOURS) — et le back-office est précisément
 *    l'endroit où l'on veut que la révocation soit immédiate.
 *
 * 2. Un cookie valide mais dont le compte est désactivé est TRAITÉ COMME NON
 *    AUTHENTIFIÉ, et le cookie est effacé. `lib/auth.ts` ne teste pas `active`
 *    (il ne connaît que la session), donc c'est ici que la révocation se
 *    termine côté requête.
 */

/** Utilisateur interne, relu en base à chaque requête. */
export type StaffUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
};

/** Capacités de l'utilisateur courant — ce que l'UI a le droit d'afficher. */
export function staffCapabilities(user: StaffUser): readonly Capability[] {
  return capabilitiesFor(user.role);
}

function selectStaffUser() {
  return { id: true, email: true, name: true, role: true, active: true } as const;
}

/**
 * Utilisateur courant, relu en base, ou `null`.
 * Ne redirige pas : utilisable depuis un layout qui doit aussi rendre la page
 * de connexion (non authentifiée).
 */
export async function findStaffUser(): Promise<StaffUser | null> {
  const session = await getSessionFromCookie();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: selectStaffUser(),
  });
  if (!user || !user.active) return null;
  return user;
}

/** Variante route handler : lit la session depuis la `NextRequest`. */
export async function findStaffUserFromRequest(req: NextRequest): Promise<StaffUser | null> {
  const session = await getSessionFromRequest(req);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: selectStaffUser(),
  });
  if (!user || !user.active) return null;
  return user;
}

/**
 * Garde de PAGE : exige une session valide et un compte actif, sinon redirige
 * vers /admin/login. À utiliser dans tout Server Component de `(admin)/admin`.
 */
export async function requireStaff(): Promise<StaffUser> {
  const user = await findStaffUser();
  if (!user) {
    await clearSessionCookie();
    redirect("/admin/login");
  }
  return user;
}

/**
 * Garde de PAGE par rôle : exige AU MOINS UN des rôles listés (OU logique —
 * c'est la lecture usuelle de `requireRole("ADMIN", "STAFF")`).
 *
 * Un utilisateur authentifié mais sans le rôle part sur /admin/forbidden :
 * une page blanche ou une redirection silencieuse vers le tableau de bord
 * laisserait croire à un bug (« le lien ne marche pas ») au lieu de dire
 * « ton compte n'a pas ce droit ».
 */
export async function requireRole(...roles: readonly Role[]): Promise<StaffUser> {
  const user = await requireStaff();
  if (!roles.includes(user.role)) {
    redirect("/admin/forbidden");
  }
  return user;
}

/**
 * Garde de PAGE par capacité : exige TOUTES les capacités listées (ET logique).
 *
 * Forme recommandée par §13 des CONVENTIONS pour les pages admin : la page
 * déclare ce qu'elle expose (`users:read`), pas qui a le droit.
 */
export async function requireCapability(...capabilities: readonly Capability[]): Promise<StaffUser> {
  const user = await requireStaff();
  if (!canAll(user.role, capabilities)) {
    redirect("/admin/forbidden");
  }
  return user;
}

/**
 * Résultat d'une garde d'API : soit l'utilisateur autorisé, soit la réponse
 * d'échec déjà construite. Un route handler n'a ainsi qu'à faire
 * `if (!access.ok) return access.response;`.
 */
export type ApiAccess =
  | { ok: true; user: StaffUser }
  | { ok: false; response: NextResponse };

const UNAUTHENTICATED = { error: "Authentification requise", code: "UNAUTHENTICATED" } as const;
const FORBIDDEN = { error: "Votre compte n'a pas les droits pour cette action", code: "FORBIDDEN" } as const;

async function apiAccess(req: NextRequest, allowed: (user: StaffUser) => boolean): Promise<ApiAccess> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return { ok: false, response: NextResponse.json(UNAUTHENTICATED, { status: 401 }) };
  }

  // Relecture en base : le rôle et l'état du compte ont pu changer depuis la
  // création de la session (cf. décision 1 en tête de fichier).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: selectStaffUser(),
  });

  if (!user) {
    return { ok: false, response: NextResponse.json(UNAUTHENTICATED, { status: 401 }) };
  }
  if (!user.active) {
    // Compte fermé : on révoque la session au passage pour ne pas laisser
    // traîner un cookie qui ne vaut plus rien.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    const response = NextResponse.json(
      { error: "Ce compte est désactivé", code: "ACCOUNT_DISABLED" },
      { status: 403 },
    );
    clearSessionCookieOnResponse(response);
    return { ok: false, response };
  }
  if (!allowed(user)) {
    return { ok: false, response: NextResponse.json(FORBIDDEN, { status: 403 }) };
  }
  return { ok: true, user };
}

/**
 * Garde d'API par rôle (OU logique). Renvoie 401 si non authentifié, 403 si le
 * rôle ne suffit pas — un `fetch` XHR doit recevoir un statut, jamais une
 * redirection HTML (cf. §11 des CONVENTIONS).
 */
export function requireApiRole(req: NextRequest, ...roles: readonly Role[]): Promise<ApiAccess> {
  return apiAccess(req, (user) => roles.includes(user.role));
}

/** Garde d'API par capacité (ET logique) — forme recommandée par §13. */
export function requireApiCapability(
  req: NextRequest,
  ...capabilities: readonly Capability[]
): Promise<ApiAccess> {
  return apiAccess(req, (user) => canAll(user.role, capabilities));
}

/** Raccourci lisible pour les routes réservées à l'administration. */
export function requireApiAdmin(req: NextRequest): Promise<ApiAccess> {
  return requireApiRole(req, "ADMIN");
}

/** `true` si l'utilisateur peut voir/ouvrir la ressource — pour l'UI. */
export function staffCan(user: StaffUser, capability: Capability): boolean {
  return can(user.role, capability);
}
