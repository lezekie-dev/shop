import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as logout } from "@/app/api/admin/logout/route";
import { hashPassword } from "@/lib/auth";
import { NextRequest } from "next/server";

const ADMIN_EMAIL = "admin@shop.local";
const ADMIN_PASSWORD = "admin1234";

function jsonRequest(url: string, body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  // S'assure qu'on a un admin de seed (idempotent).
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash },
    create: { email: ADMIN_EMAIL, passwordHash, role: "ADMIN" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Nettoie les sessions résiduelles entre tests pour des assertions déterministes.
  await prisma.session.deleteMany({});
});

describe("POST /api/admin/login", () => {
  it("renvoie 200 + cookie pour les bons identifiants", async () => {
    const req = jsonRequest("http://localhost:3000/api/admin/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    const res = await login(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/admin_session=/);

    const session = await prisma.session.findFirst({ where: { user: { email: ADMIN_EMAIL } } });
    expect(session).toBeTruthy();
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("renvoie 401 pour un mauvais mot de passe", async () => {
    const req = jsonRequest("http://localhost:3000/api/admin/login", {
      email: ADMIN_EMAIL,
      password: "wrong-password",
    });
    const res = await login(req);
    expect(res.status).toBe(401);

    const sessions = await prisma.session.count();
    expect(sessions).toBe(0);
  });

  it("renvoie 400 pour un body invalide", async () => {
    const req = jsonRequest("http://localhost:3000/api/admin/login", { email: "x" });
    const res = await login(req);
    expect(res.status).toBe(400);
  });

  it("renvoie 401 pour un email inconnu", async () => {
    const req = jsonRequest("http://localhost:3000/api/admin/login", {
      email: "unknown@example.com",
      password: "whatever",
    });
    const res = await login(req);
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/logout supprime la session et clear le cookie", async () => {
    // Crée une session en DB pour simuler un login existant.
    await prisma.session.create({
      data: {
        token: "test-token-to-delete",
        userId: (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const req = new NextRequest("http://localhost:3000/api/admin/logout", {
      method: "POST",
      headers: { cookie: "admin_session=test-token-to-delete" },
    });
    const res = await logout(req);
    expect(res.status).toBe(204);

    const remaining = await prisma.session.findUnique({ where: { token: "test-token-to-delete" } });
    expect(remaining).toBeNull();
  });
});
