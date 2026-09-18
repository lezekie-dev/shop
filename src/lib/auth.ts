import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

export type AdminUser = {
  id: string;
  email: string;
  /// Rôle issu de l'enum Prisma et non figé à "ADMIN" : le back-office gère
  /// désormais ADMIN et STAFF, et les gardes d'autorisation testent cette
  /// valeur. Laisser le type à "ADMIN" interdirait toute vérification.
  role: Role;
};

function cookieName(): string {
  return getEnv().SESSION_COOKIE_NAME;
}

function ttlMs(): number {
  return getEnv().SESSION_TTL_HOURS * 60 * 60 * 1000;
}

function cookieOpts(expiresAt: Date): {
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

export async function hashPassword(plain: string): Promise<string> {
  const rounds = getEnv().BCRYPT_ROUNDS;
  return bcrypt.hash(plain, rounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + ttlMs());
  await prisma.session.create({
    data: { token, userId, expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Pose le cookie de session sur une `NextResponse` (route handlers).
 * En Server Components, utilisez `setSessionCookieViaStore` à la place.
 */
export function setSessionCookieOnResponse(res: NextResponse, token: string, expiresAt: Date): void {
  res.cookies.set(cookieName(), token, cookieOpts(expiresAt));
}

export function clearSessionCookieOnResponse(res: NextResponse): void {
  res.cookies.set(cookieName(), "", { ...cookieOpts(new Date(0)), maxAge: 0 });
}

/** Pour Server Components / Server Actions qui ont accès à cookies() via next/headers. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = cookies();
  store.set(cookieName(), token, cookieOpts(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = cookies();
  store.set(cookieName(), "", { ...cookieOpts(new Date(0)), maxAge: 0 });
}

export type SessionWithUser = {
  session: { id: string; token: string; expiresAt: Date };
  user: AdminUser;
};

/** Lit la session depuis le cookie d'une NextRequest (route handlers + middleware). */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionWithUser | null> {
  const token = req.cookies.get(cookieName())?.value;
  if (!token) return null;
  return findSession(token);
}

/** Lit la session depuis cookies() (Server Components). */
export async function getSessionFromCookie(): Promise<SessionWithUser | null> {
  const token = cookies().get(cookieName())?.value;
  if (!token) return null;
  return findSession(token);
}

async function findSession(token: string): Promise<SessionWithUser | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user) return null;
  return {
    session: { id: session.id, token: session.token, expiresAt: session.expiresAt },
    user: { id: session.user.id, email: session.user.email, role: session.user.role },
  };
}

export async function getCurrentUser(): Promise<AdminUser | null> {
  const found = await getSessionFromCookie();
  return found?.user ?? null;
}

export async function requireAdmin(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/admin/login");
  }
  return user;
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

/**
 * Garde d'authentification pour les route handlers (`/api/admin/**`).
 *
 * Équivalent requête de `requireAdmin()` : même cookie, même lookup de session
 * en base, mais renvoie `null` au lieu de rediriger — un `fetch` XHR doit
 * recevoir 401, pas une redirection HTML vers /admin/login.
 */
export async function requireAdminApi(req: NextRequest): Promise<AdminUser | null> {
  const found = await getSessionFromRequest(req);
  return found?.user ?? null;
}
