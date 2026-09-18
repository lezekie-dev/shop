import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";

import { PATCH as patchUser, GET as getUser } from "@/app/api/admin/users/[id]/route";
import { GET as listUsers, POST as createUser } from "@/app/api/admin/users/route";
import { POST as login } from "@/app/api/admin/login/route";
import { hashPassword } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";

/**
 * Gestion des utilisateurs du back-office (capacités `users:read` / `users:write`).
 *
 * Ce que ce fichier verrouille :
 *   - STAFF n'atteint NI l'API NI les routes réservées à ADMIN (403, pas un
 *     menu masqué) ;
 *   - STAFF ne peut pas se promouvoir ADMIN (l'escalade de privilèges la plus
 *     évidente : PATCH sur son propre compte) ;
 *   - le DERNIER administrateur actif ne peut être ni désactivé ni rétrogradé
 *     (sinon la boutique devient inadministrable) ;
 *   - un compte désactivé ne peut plus se connecter et ses sessions sont
 *     révoquées ;
 *   - toute action sensible écrit une ligne d'AuditLog.
 */

const ADMIN_EMAIL = "admin@shop.local";
const ADMIN_PASSWORD = "admin1234";

function jsonRequest(
  url: string,
  body: unknown,
  opts: { method?: string; token?: string } = {},
): NextRequest {
  return new NextRequest(url, {
    method: opts.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { cookie: `admin_session=${opts.token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, token?: string): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: token ? { cookie: `admin_session=${token}` } : {},
  });
}

/** Crée un utilisateur interne et une session valide pour lui. */
async function staffSession(
  role: Role,
  email = `${role.toLowerCase()}-${newId().slice(0, 8)}@shop.local`,
): Promise<{ token: string; userId: string; email: string }> {
  const user = await prismaTest.user.create({
    data: {
      email,
      name: role === "ADMIN" ? "Admin test" : "Opérateur test",
      role,
      active: true,
      passwordHash: await hashPassword("motdepasse-de-test"),
    },
  });
  const token = newId();
  await prismaTest.session.create({
    data: { token, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { token, userId: user.id, email };
}

beforeEach(async () => {
  await resetDb();
  await seedFixtures();
  // `resetDb()` ne tronque pas LoginAttempt (table sans FK vers User) : on la
  // vide ici pour que les compteurs de rate limiting d'un test ne bloquent pas
  // le suivant.
  await prismaTest.loginAttempt.deleteMany({});
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────
// Lecture de la liste
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  it("renvoie la liste à un administrateur, sans hash de mot de passe ni secret TOTP", async () => {
    const admin = await staffSession("ADMIN");
    const res = await listUsers(getRequest("http://localhost:3000/api/admin/users", admin.token));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<Record<string, unknown>> };
    expect(body.users.length).toBeGreaterThanOrEqual(2);
    // Le DTO ne doit exposer aucun secret : le hash bcrypt permettrait une
    // attaque hors ligne, le secret TOTP permettrait de fabriquer les codes.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("totpSecret");
    expect(serialized).not.toContain("$2a$");
  });

  it("REFUSE un STAFF (403 FORBIDDEN)", async () => {
    const staff = await staffSession("STAFF");
    const res = await listUsers(getRequest("http://localhost:3000/api/admin/users", staff.token));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("REFUSE une requête sans session (401)", async () => {
    const res = await listUsers(getRequest("http://localhost:3000/api/admin/users"));
    expect(res.status).toBe(401);
  });

  it("renvoie la fiche d'un utilisateur à un administrateur, 404 si inconnu", async () => {
    const admin = await staffSession("ADMIN");
    const target = await staffSession("STAFF");

    const found = await getUser(
      getRequest(`http://localhost:3000/api/admin/users/${target.userId}`, admin.token),
      { params: { id: target.userId } },
    );
    expect(found.status).toBe(200);

    const missing = await getUser(
      getRequest("http://localhost:3000/api/admin/users/inexistant", admin.token),
      { params: { id: "inexistant" } },
    );
    expect(missing.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Création
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/users", () => {
  it("crée un compte STAFF qui peut se connecter, et journalise l'action", async () => {
    const admin = await staffSession("ADMIN");
    const res = await createUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users",
        {
          email: "Nouvel.Operateur@Shop.Local",
          name: "Nouvel opérateur",
          role: "STAFF",
          password: "motdepasse-solide",
        },
        { token: admin.token },
      ),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { id: string; email: string; role: Role; active: boolean } };
    // L'email est normalisé : c'est la clé de connexion, deux casses ne doivent
    // pas créer deux comptes.
    expect(body.user.email).toBe("nouvel.operateur@shop.local");
    expect(body.user.role).toBe("STAFF");
    expect(body.user.active).toBe(true);

    // Le mot de passe stocké est bien un hash (jamais le clair).
    const created = await prismaTest.user.findUniqueOrThrow({ where: { id: body.user.id } });
    expect(created.passwordHash).not.toBe("motdepasse-solide");
    expect(created.passwordHash.startsWith("$2")).toBe(true);

    // … et il permet réellement de se connecter.
    const loginRes = await login(
      jsonRequest("http://localhost:3000/api/admin/login", {
        email: "nouvel.operateur@shop.local",
        password: "motdepasse-solide",
      }),
    );
    expect(loginRes.status).toBe(200);
    expect(loginRes.headers.get("set-cookie")).toMatch(/admin_session=/);

    const logs = await prismaTest.auditLog.findMany({ where: { entity: "User" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("user.create");
    expect(logs[0]?.userId).toBe(admin.userId);
    // Le diff ne contient AUCUN secret.
    expect(JSON.stringify(logs[0]?.diff)).not.toContain("motdepasse-solide");
    expect(JSON.stringify(logs[0]?.diff)).not.toContain("passwordHash");
  });

  it("REFUSE un STAFF : aucun compte n'est créé", async () => {
    const staff = await staffSession("STAFF");
    const before = await prismaTest.user.count();

    const res = await createUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users",
        { email: "complice@shop.local", role: "ADMIN", password: "motdepasse-solide" },
        { token: staff.token },
      ),
    );

    expect(res.status).toBe(403);
    expect(await prismaTest.user.count()).toBe(before);
    expect(await prismaTest.auditLog.count()).toBe(0);
  });

  it("REFUSE un email déjà pris (409) et un mot de passe trop court (400)", async () => {
    const admin = await staffSession("ADMIN");

    const duplicate = await createUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users",
        { email: ADMIN_EMAIL, role: "STAFF", password: "motdepasse-solide" },
        { token: admin.token },
      ),
    );
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { code?: string }).code).toBe("EMAIL_TAKEN");

    const tooShort = await createUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users",
        { email: "court@shop.local", role: "STAFF", password: "court" },
        { token: admin.token },
      ),
    );
    expect(tooShort.status).toBe(400);
  });

  it("n'accepte qu'un rôle de l'enum (pas de rôle inventé)", async () => {
    const admin = await staffSession("ADMIN");
    const res = await createUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users",
        { email: "super@shop.local", role: "SUPER_ADMIN", password: "motdepasse-solide" },
        { token: admin.token },
      ),
    );
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Modification : escalade de privilèges
// ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/users/[id] — escalade de privilèges", () => {
  it("un STAFF ne peut PAS se promouvoir ADMIN (403, rôle inchangé)", async () => {
    const staff = await staffSession("STAFF");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        { role: "ADMIN" },
        { method: "PATCH", token: staff.token },
      ),
      { params: { id: staff.userId } },
    );

    expect(res.status).toBe(403);
    const after = await prismaTest.user.findUniqueOrThrow({ where: { id: staff.userId } });
    expect(after.role).toBe("STAFF");
    expect(await prismaTest.auditLog.count()).toBe(0);
  });

  it("un STAFF ne peut pas modifier un autre compte non plus", async () => {
    const staff = await staffSession("STAFF");
    const target = await staffSession("ADMIN");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${target.userId}`,
        { active: false },
        { method: "PATCH", token: staff.token },
      ),
      { params: { id: target.userId } },
    );

    expect(res.status).toBe(403);
    const after = await prismaTest.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(after.active).toBe(true);
  });

  it("sans session : 401", async () => {
    const target = await staffSession("STAFF");
    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${target.userId}`,
        { role: "ADMIN" },
        { method: "PATCH" },
      ),
      { params: { id: target.userId } },
    );
    expect(res.status).toBe(401);
  });

  it("un administrateur peut modifier nom, email et rôle d'un opérateur", async () => {
    const admin = await staffSession("ADMIN");
    const staff = await staffSession("STAFF");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        { name: "Aïcha D.", email: "aicha@shop.local", role: "ADMIN" },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: staff.userId } },
    );

    expect(res.status).toBe(200);
    const after = await prismaTest.user.findUniqueOrThrow({ where: { id: staff.userId } });
    expect(after.name).toBe("Aïcha D.");
    expect(after.email).toBe("aicha@shop.local");
    expect(after.role).toBe("ADMIN");

    const logs = await prismaTest.auditLog.findMany({ where: { entityId: staff.userId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("user.update");
    expect(JSON.stringify(logs[0]?.diff)).toContain("aicha@shop.local");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Règle du dernier administrateur actif
// ─────────────────────────────────────────────────────────────────────

describe("règle du dernier administrateur actif", () => {
  it("impossible de DÉSACTIVER le dernier admin actif (409 LAST_ADMIN)", async () => {
    const admin = await staffSession("ADMIN");
    // Le seed a créé un admin ; on le passe STAFF pour que `admin` soit le seul
    // administrateur actif.
    await prismaTest.user.update({ where: { email: ADMIN_EMAIL }, data: { role: "STAFF" } });

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { active: false },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("LAST_ADMIN");
    const after = await prismaTest.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(after.active).toBe(true);
    expect(await prismaTest.auditLog.count()).toBe(0);
  });

  it("impossible de RÉTROGRADER le dernier admin actif (409 LAST_ADMIN)", async () => {
    const admin = await staffSession("ADMIN");
    await prismaTest.user.update({ where: { email: ADMIN_EMAIL }, data: { role: "STAFF" } });

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { role: "STAFF" },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(res.status).toBe(409);
    const after = await prismaTest.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(after.role).toBe("ADMIN");
  });

  it("autorise la désactivation quand un autre administrateur actif existe", async () => {
    const admin = await staffSession("ADMIN");
    const otherAdmin = await staffSession("ADMIN");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { active: false },
        { method: "PATCH", token: otherAdmin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(res.status).toBe(200);
    const after = await prismaTest.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(after.active).toBe(false);
  });

  it("autorise à rétrograder dès qu'un second admin actif existe", async () => {
    const admin = await staffSession("ADMIN");
    const otherAdmin = await staffSession("ADMIN");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { role: "STAFF" },
        { method: "PATCH", token: otherAdmin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(res.status).toBe(200);
    expect((await prismaTest.user.findUniqueOrThrow({ where: { id: admin.userId } })).role).toBe("STAFF");
  });

  it("autorise à renommer ou changer l'email du dernier admin (pas une perte de droit)", async () => {
    const admin = await staffSession("ADMIN");
    await prismaTest.user.update({ where: { email: ADMIN_EMAIL }, data: { role: "STAFF" } });

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { name: "Administrateur principal" },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Désactivation : plus de connexion, sessions fermées
// ─────────────────────────────────────────────────────────────────────

describe("compte désactivé", () => {
  it("ne peut plus se connecter (403 ACCOUNT_DISABLED) et n'obtient aucune session", async () => {
    const staff = await staffSession("STAFF");
    await prismaTest.session.deleteMany({});
    await prismaTest.user.update({ where: { id: staff.userId }, data: { active: false } });

    const res = await login(
      jsonRequest("http://localhost:3000/api/admin/login", {
        email: staff.email,
        password: "motdepasse-de-test",
      }),
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("ACCOUNT_DISABLED");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await prismaTest.session.count({ where: { userId: staff.userId } })).toBe(0);
  });

  it("ne peut pas non plus appeler une API admin (403, session révoquée)", async () => {
    const admin = await staffSession("ADMIN");
    await prismaTest.user.update({ where: { id: admin.userId }, data: { active: false } });

    const res = await createUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users",
        { email: "x@shop.local", role: "STAFF", password: "motdepasse-solide" },
        { token: admin.token },
      ),
    );

    // Le compte a été fermé APRÈS la création de la session : la garde relit
    // `active` en base à chaque requête, donc le cookie encore valide ne suffit
    // pas — et la session est supprimée au passage.
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("ACCOUNT_DISABLED");
    expect(await prismaTest.session.count({ where: { userId: admin.userId } })).toBe(0);
  });

  it("désactiver un compte ferme ses sessions en cours", async () => {
    const admin = await staffSession("ADMIN");
    const otherAdmin = await staffSession("ADMIN");
    expect(await prismaTest.session.count({ where: { userId: admin.userId } })).toBe(1);

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { active: false },
        { method: "PATCH", token: otherAdmin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(res.status).toBe(200);
    expect(await prismaTest.session.count({ where: { userId: admin.userId } })).toBe(0);
  });

  it("un compte désactivé peut être réactivé et se reconnecter", async () => {
    const admin = await staffSession("ADMIN");
    const otherAdmin = await staffSession("ADMIN");

    await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { active: false },
        { method: "PATCH", token: otherAdmin.token },
      ),
      { params: { id: admin.userId } },
    );
    await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { active: true },
        { method: "PATCH", token: otherAdmin.token },
      ),
      { params: { id: admin.userId } },
    );

    const res = await login(
      jsonRequest("http://localhost:3000/api/admin/login", {
        email: admin.email,
        password: "motdepasse-de-test",
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Détails de mise à jour
// ─────────────────────────────────────────────────────────────────────

describe("détails de mise à jour", () => {
  it("404 sur un utilisateur inconnu", async () => {
    const admin = await staffSession("ADMIN");
    const res = await patchUser(
      jsonRequest(
        "http://localhost:3000/api/admin/users/inconnu",
        { name: "X" },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: "inconnu" } },
    );
    expect(res.status).toBe(404);
  });

  it("400 sur un body vide ou un email invalide", async () => {
    const admin = await staffSession("ADMIN");
    const staff = await staffSession("STAFF");

    const empty = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        {},
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: staff.userId } },
    );
    expect(empty.status).toBe(400);

    const badEmail = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        { email: "pas-un-email" },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: staff.userId } },
    );
    expect(badEmail.status).toBe(400);
  });

  it("409 si le nouvel email est déjà utilisé, et rien n'est écrit", async () => {
    const admin = await staffSession("ADMIN");
    const staff = await staffSession("STAFF");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        { email: ADMIN_EMAIL },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: staff.userId } },
    );

    expect(res.status).toBe(409);
    expect((await prismaTest.user.findUniqueOrThrow({ where: { id: staff.userId } })).email).toBe(
      staff.email,
    );
    expect(await prismaTest.auditLog.count()).toBe(0);
  });

  it("une sauvegarde sans changement n'écrit pas de ligne d'audit trompeuse", async () => {
    const admin = await staffSession("ADMIN");
    const staff = await staffSession("STAFF");

    const res = await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        // Valeurs identiques à l'état courant : rien ne change réellement.
        { name: "Opérateur test", email: staff.email, role: "STAFF", active: true },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: staff.userId } },
    );

    expect(res.status).toBe(200);
    expect(await prismaTest.auditLog.count()).toBe(0);
  });

  it("la promotion d'un STAFF prend effet immédiatement, sans reconnexion", async () => {
    const admin = await staffSession("ADMIN");
    const staff = await staffSession("STAFF");

    // Avant : STAFF n'a pas `users:read`.
    const before = await listUsers(getRequest("http://localhost:3000/api/admin/users", staff.token));
    expect(before.status).toBe(403);

    await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${staff.userId}`,
        { role: "ADMIN" },
        { method: "PATCH", token: admin.token },
      ),
      { params: { id: staff.userId } },
    );

    // Après : le MÊME cookie donne accès, parce que le rôle est relu en base à
    // chaque requête (pas de rôle figé dans la session).
    const after = await listUsers(getRequest("http://localhost:3000/api/admin/users", staff.token));
    expect(after.status).toBe(200);
  });

  it("la rétrogradation d'un ADMIN prend effet immédiatement", async () => {
    const admin = await staffSession("ADMIN");
    const otherAdmin = await staffSession("ADMIN");

    expect(
      (await listUsers(getRequest("http://localhost:3000/api/admin/users", admin.token))).status,
    ).toBe(200);

    await patchUser(
      jsonRequest(
        `http://localhost:3000/api/admin/users/${admin.userId}`,
        { role: "STAFF" },
        { method: "PATCH", token: otherAdmin.token },
      ),
      { params: { id: admin.userId } },
    );

    expect(
      (await listUsers(getRequest("http://localhost:3000/api/admin/users", admin.token))).status,
    ).toBe(403);
  });
});
