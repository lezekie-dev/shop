import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import React from "react";

// Vitest transforme le JSX en `React.createElement` (mode « classic ») alors
// que les pages Next n'importent pas React : sans cette affectation, toute page
// réellement rendue lève « React is not defined ». On ne modifie pas
// vitest.config.ts pour ne pas toucher un fichier partagé par d'autres
// chantiers en cours.
(globalThis as unknown as { React: unknown }).React = React;

/**
 * Espace client — inscription, connexion, déconnexion, commandes, adresses.
 *
 * Les cas testés ici sont ceux qui coûtent cher quand ils cassent :
 *  - rattachement d'un compte à une fiche INVITÉ (sinon l'historique est perdu
 *    et la contrainte unique sur `email` explose)
 *  - refus d'écraser un mot de passe existant, avec un message qui ne dit pas
 *    si l'email est connu (énumération de comptes)
 *  - cloisonnement des sessions admin/client et des compteurs de tentatives
 *  - un client ne voit QUE ses commandes (filtre par customerId de session)
 */

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

// `cookies()` n'existe pas hors d'une requête Next : on fournit le strict
// nécessaire (get/set) pour que les pages et `lib/customer-auth` soient
// exécutables telles quelles dans le test.
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

import { POST as registerRoute } from "@/app/api/account/register/route";
import { POST as loginRoute } from "@/app/api/account/login/route";
import { POST as logoutRoute } from "@/app/api/account/logout/route";
import { GET as accountOrderGet } from "@/app/api/account/orders/[id]/route";
import {
  GET as addressesGet,
  POST as addressesPost,
} from "@/app/api/account/addresses/route";
import {
  DELETE as addressDelete,
  PATCH as addressPatch,
} from "@/app/api/account/addresses/[id]/route";
import AccountOrdersPage from "@/app/(shop)/compte/page";
import AccountOrderDetailPage from "@/app/(shop)/compte/commandes/[id]/page";
import { hashPassword, verifyPassword, requireAdminApi } from "@/lib/auth";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-auth";
import { generateOrderAccessToken } from "@/lib/order-token";
import {
  ADMIN_RATE_LIMIT_SCOPE,
  CUSTOMER_RATE_LIMIT_SCOPE,
  checkLoginRateLimit,
  recordLoginAttempt,
} from "@/server/login-rate-limit";
import { REGISTRATION_REFUSED_MESSAGE } from "@/server/customer-account";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";

const BASE = "http://localhost:3000";
const IP = "203.0.113.42";
const PASSWORD = "mot-de-passe-solide";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;
  if (options.ip) headers["x-forwarded-for"] = options.ip;

  return new NextRequest(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

/** Cookie de session client extrait de la réponse d'un login/register. */
function sessionCookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = /customer_session=([^;]+)/.exec(raw);
  if (!match?.[1]) throw new Error("aucun cookie customer_session dans la réponse");
  return `${CUSTOMER_SESSION_COOKIE}=${match[1]}`;
}

async function registerCustomer(
  email: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return registerRoute(
    request("/api/account/register", {
      method: "POST",
      ip: IP,
      body: { email, password: PASSWORD, firstName: "Aïcha", lastName: "Ndiaye", ...extra },
    }),
  );
}

async function loginCustomer(email: string, password: string): Promise<Response> {
  return loginRoute(
    request("/api/account/login", { method: "POST", ip: IP, body: { email, password } }),
  );
}

/**
 * Client « invité » : la ligne que crée le checkout, sans mot de passe.
 * C'est l'état de départ du cas de rattachement.
 */
async function createGuestCustomer(email: string, firstName = "Aïcha", lastName = "Ndiaye") {
  return prismaTest.customer.create({
    data: { email, firstName, lastName, passwordHash: null },
  });
}

/** Commande complète (adresse + ligne + expédition optionnelle) pour un client. */
async function createOrder(params: {
  customerId: string;
  variantId: string;
  number: string;
  status?: "PENDING_PAYMENT" | "PAID" | "SHIPPED";
  withShipment?: boolean;
}) {
  const address = await prismaTest.address.create({
    data: {
      customerId: params.customerId,
      line1: "12 rue des Lilas",
      city: "Douala",
      postalCode: "00237",
      country: "FR",
      isDefault: true,
    },
  });

  const unitPriceCents = 1990;
  const quantity = 2;
  const subtotalCents = unitPriceCents * quantity;

  const order = await prismaTest.order.create({
    data: {
      number: params.number,
      accessToken: generateOrderAccessToken(),
      customerId: params.customerId,
      addressId: address.id,
      status: params.status ?? "PAID",
      subtotalCents,
      shippingCents: 590,
      totalCents: subtotalCents + 590,
      paymentProvider: "mock",
      items: {
        create: [
          {
            variantId: params.variantId,
            quantity,
            unitPriceCents,
            productNameSnapshot: "T-shirt basique blanc",
            variantNameSnapshot: "Blanc / M",
          },
        ],
      },
    },
  });

  const shipment = params.withShipment
    ? await prismaTest.shipment.create({
        data: {
          orderId: order.id,
          carrier: "DHL Démo",
          trackingNo: "DHL-0001",
          trackingUrl: "https://example.test/suivi/DHL-0001",
          status: "IN_TRANSIT",
          shippedAt: new Date(),
        },
      })
    : null;

  return { order, address, shipment };
}

/** Le client connecté après un parcours d'inscription réel. */
async function signedInCustomer(email: string): Promise<{ customerId: string; cookie: string }> {
  const res = await registerCustomer(email);
  expect(res.status, "l'inscription de préparation doit réussir").toBe(201);
  const cookie = sessionCookie(res);
  const customer = await prismaTest.customer.findUniqueOrThrow({ where: { email } });
  return { customerId: customer.id, cookie };
}

async function expectRedirectTo(promise: Promise<unknown>, path: string): Promise<void> {
  try {
    await promise;
    expect.unreachable("la page aurait dû rediriger l'appelant anonyme");
  } catch (err) {
    const digest = String((err as { digest?: string }).digest ?? "");
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain(path);
  }
}

/**
 * Texte visible d'un arbre d'éléments React, sans rendu DOM.
 *
 * `JSON.stringify` sur un élément React explose (structures circulaires) et
 * `react-dom/server` exige un contexte de routeur Next absent en test. Parcourir
 * les `props.children` suffit pour vérifier ce que le client verra réellement.
 */
function visibleText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return visibleText(props?.children);
  }
  return "";
}

beforeEach(async () => {
  await resetDb();
  // `resetDb` tronque les tables listées dans le helper ; `LoginAttempt` n'y est
  // pas (elle n'a aucune clé étrangère). On la vide ici pour que les tests de
  // plafonnement ne dépendent pas de l'ordre d'exécution des fichiers.
  await prismaTest.loginAttempt.deleteMany({});
  await prismaTest.customerSession.deleteMany({});
  cookieJar.clear();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────
// Inscription
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/account/register", () => {
  it("rattache le compte à la fiche client INVITÉ et conserve l'historique de commandes", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const guest = await createGuestCustomer("acheteuse@shop.local", "Aïcha", "Ndiaye");
    const { order } = await createOrder({
      customerId: guest.id,
      variantId: variant.id,
      number: "ORD-2026-000101",
    });

    const res = await registerCustomer("acheteuse@shop.local");
    expect(res.status).toBe(201);

    // Une SEULE ligne Customer : le compte a été greffé, pas dupliqué. Une
    // seconde ligne violerait la contrainte unique sur email.
    const customers = await prismaTest.customer.findMany({
      where: { email: "acheteuse@shop.local" },
    });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.id).toBe(guest.id);
    expect(customers[0]!.passwordHash).not.toBeNull();
    // L'identité saisie au checkout n'est pas écrasée : c'est le nom qui figure
    // sur les commandes déjà passées.
    expect(customers[0]!.firstName).toBe("Aïcha");
    expect(customers[0]!.lastName).toBe("Ndiaye");

    // La commande est toujours rattachée au même client.
    const orderAfter = await prismaTest.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfter.customerId).toBe(guest.id);

    // Et le mot de passe fonctionne.
    const login = await loginCustomer("acheteuse@shop.local", PASSWORD);
    expect(login.status).toBe(200);
  });

  it("refuse un email déjà pourvu d'un mot de passe, sans toucher au hash existant", async () => {
    const existing = await prismaTest.customer.create({
      data: {
        email: "deja-inscrit@shop.local",
        passwordHash: await hashPassword("mot-de-passe-initial"),
        firstName: "Ancien",
        lastName: "Compte",
      },
    });

    const res = await registerCustomer("deja-inscrit@shop.local");
    expect(res.status).toBe(409);

    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe(REGISTRATION_REFUSED_MESSAGE);
    // Le message est le même quelle que soit la cause : il ne confirme jamais
    // que l'email existe, il décrit seulement quoi faire.
    expect(body.error).not.toMatch(/n'existe pas|introuvable|inconnu/i);

    const after = await prismaTest.customer.findUniqueOrThrow({ where: { id: existing.id } });
    expect(await verifyPassword("mot-de-passe-initial", after.passwordHash as string)).toBe(true);
    expect(await verifyPassword(PASSWORD, after.passwordHash as string)).toBe(false);
  });

  it("crée une nouvelle fiche pour un email inconnu", async () => {
    const res = await registerCustomer("nouvelle@shop.local");
    expect(res.status).toBe(201);

    const created = await prismaTest.customer.findUniqueOrThrow({
      where: { email: "nouvelle@shop.local" },
    });
    expect(created.passwordHash).not.toBeNull();
  });

  it("refuse un mot de passe trop court (400)", async () => {
    const res = await registerRoute(
      request("/api/account/register", {
        method: "POST",
        ip: IP,
        body: {
          email: "court@shop.local",
          password: "123",
          firstName: "A",
          lastName: "B",
        },
      }),
    );
    expect(res.status).toBe(400);
    expect(await prismaTest.customer.count()).toBe(0);
  });

  it("normalise l'email (casse et espaces) pour retrouver la fiche invité", async () => {
    const guest = await createGuestCustomer("mixte@shop.local");
    const res = await registerCustomer("  Mixte@Shop.Local  ");
    expect(res.status).toBe(201);

    const customers = await prismaTest.customer.findMany({ where: { email: "mixte@shop.local" } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.id).toBe(guest.id);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Connexion
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/account/login", () => {
  it("ouvre une session client (cookie + table CustomerSession, pas la table Session)", async () => {
    await registerCustomer("cliente@shop.local");

    const res = await loginCustomer("cliente@shop.local", PASSWORD);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/customer_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    // L'inscription a déjà ouvert une session (on ne redemande pas le mot de
    // passe juste après l'avoir créé) : le login en ouvre donc une SECONDE.
    // Deux sessions actives sont légitimes — deux appareils, deux jetons.
    const sessions = await prismaTest.customerSession.findMany();
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }

    // La session ADMIN n'est pas touchée : deux tables, deux espaces.
    expect(await prismaTest.session.count()).toBe(0);
  });

  it("renvoie le même message pour un mauvais mot de passe et un compte inexistant", async () => {
    await registerCustomer("cliente@shop.local");

    const badPassword = await loginCustomer("cliente@shop.local", "mauvais-mot-de-passe");
    const unknownEmail = await loginCustomer("personne@shop.local", "mauvais-mot-de-passe");

    expect(badPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await badPassword.json()).toEqual(await unknownEmail.json());
    // Aucun des deux logins échoués n'a ouvert de session : la seule
    // présente est celle de l'inscription de préparation.
    expect(await prismaTest.customerSession.count()).toBe(1);
  });

  it("refuse la connexion d'un client invité (aucun mot de passe enregistré)", async () => {
    await createGuestCustomer("invite@shop.local");
    const res = await loginCustomer("invite@shop.local", PASSWORD);
    expect(res.status).toBe(401);
    expect(await prismaTest.customerSession.count()).toBe(0);
  });

  it("met à jour lastLoginAt au succès", async () => {
    await registerCustomer("cliente@shop.local");
    await loginCustomer("cliente@shop.local", PASSWORD);

    const customer = await prismaTest.customer.findUniqueOrThrow({
      where: { email: "cliente@shop.local" },
    });
    expect(customer.lastLoginAt).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Plafonnement des tentatives (portée « customer »)
// ─────────────────────────────────────────────────────────────────────

describe("plafonnement des tentatives de connexion client", () => {
  it("bloque en 429 après 5 échecs et annonce un délai", async () => {
    await registerCustomer("cible@shop.local");

    for (let i = 0; i < 5; i++) {
      const res = await loginCustomer("cible@shop.local", "mauvais-mot-de-passe");
      expect(res.status).toBe(401);
    }

    const blocked = await loginCustomer("cible@shop.local", PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // Le mot de passe correct ne contourne pas le plafond : on refuse AVANT
    // de le comparer, donc aucune session supplémentaire n'est ouverte.
    // Il reste exactement 1 session : celle créée par l'inscription, qui
    // connecte le client sans lui redemander son mot de passe.
    expect(await prismaTest.customerSession.count()).toBe(1);
  });

  it("compte les tentatives avec la portée « customer »", async () => {
    await registerCustomer("cible@shop.local");
    await loginCustomer("cible@shop.local", "mauvais-mot-de-passe");

    // Une tentative RÉUSSIE n'écrit pas de ligne : elle EFFACE les échecs
    // précédents (`deleteMany` sur succeeded: false). C'est le comportement
    // voulu — un utilisateur qui s'est trompé 4 fois puis réussit ne doit pas
    // rester à un essai du blocage. Après une inscription réussie (qui
    // efface) puis un login raté (qui écrit), il reste donc UNE ligne : celle
    // de l'échec, marquée du bon périmètre.
    const attempts = await prismaTest.loginAttempt.findMany();
    expect(attempts).toHaveLength(1);
    const failed = attempts[0]!;
    expect(failed.succeeded).toBe(false);
    expect(failed.scope).toBe(CUSTOMER_RATE_LIMIT_SCOPE);
    expect(failed.identifier).toBe("cible@shop.local");
  });

  it("ne consomme PAS le quota admin du même identifiant (et inversement)", async () => {
    const email = "partage@shop.local";
    await registerCustomer(email);

    // 5 échecs côté client…
    for (let i = 0; i < 5; i++) await loginCustomer(email, "mauvais-mot-de-passe");

    // …bloquent le client…
    expect(
      (await checkLoginRateLimit({ identifier: email, ip: IP, scope: CUSTOMER_RATE_LIMIT_SCOPE }))
        .allowed,
    ).toBe(false);
    // …mais pas le back-office, qui a son propre compteur.
    expect((await checkLoginRateLimit({ identifier: email, ip: IP })).allowed).toBe(true);

    // Sens inverse : des échecs admin ne bloquent pas le client.
    await prismaTest.loginAttempt.deleteMany({});
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt({
        identifier: email,
        succeeded: false,
        ip: IP,
        scope: ADMIN_RATE_LIMIT_SCOPE,
      });
    }
    expect(
      (await checkLoginRateLimit({ identifier: email, ip: IP, scope: CUSTOMER_RATE_LIMIT_SCOPE }))
        .allowed,
    ).toBe(true);

    // La connexion client réussit donc malgré l'orage côté admin.
    const res = await loginCustomer(email, PASSWORD);
    expect(res.status).toBe(200);
  });

  it("une inscription refusée alimente le même compteur (pas d'oracle gratuit)", async () => {
    const email = "connu@shop.local";
    await prismaTest.customer.create({
      data: { email, passwordHash: await hashPassword("mot-de-passe-initial") },
    });

    for (let i = 0; i < 5; i++) {
      const res = await registerCustomer(email);
      expect(res.status).toBe(409);
    }

    const blocked = await registerCustomer(email);
    expect(blocked.status).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Garde d'accès aux pages
// ─────────────────────────────────────────────────────────────────────

describe("garde de l'espace client", () => {
  it("redirige /compte vers la connexion sans session", async () => {
    await expectRedirectTo(AccountOrdersPage({ searchParams: {} }), "/compte/connexion");
  });

  it("rend la page avec une session client valide", async () => {
    const { cookie } = await signedInCustomer("connectee@shop.local");
    cookieJar.set(CUSTOMER_SESSION_COOKIE, cookie.split("=")[1] as string);

    const element = await AccountOrdersPage({ searchParams: {} });
    expect(element).toBeTruthy();
    expect(typeof element).toBe("object");
  });

  it("un cookie de session ADMIN n'ouvre pas l'espace client", async () => {
    const user = await prismaTest.user.create({
      data: { email: "admin@shop.local", passwordHash: await hashPassword("admin1234") },
    });
    await prismaTest.session.create({
      data: { token: "jeton-admin", userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    // Le navigateur envoie les deux cookies possibles.
    cookieJar.set("admin_session", "jeton-admin");
    cookieJar.set(CUSTOMER_SESSION_COOKIE, "jeton-admin");

    await expectRedirectTo(AccountOrdersPage({ searchParams: {} }), "/compte/connexion");
  });

  it("un cookie client ne donne aucun accès au back-office", async () => {
    const { cookie } = await signedInCustomer("connectee@shop.local");
    const admin = await requireAdminApi(request("/api/admin/orders", { cookie }));
    expect(admin).toBeNull();
  });

  it("une session expirée est refusée et supprimée", async () => {
    const customer = await createGuestCustomer("expiree@shop.local");
    await prismaTest.customerSession.create({
      data: {
        token: "session-perimee",
        customerId: customer.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    cookieJar.set(CUSTOMER_SESSION_COOKIE, "session-perimee");

    await expectRedirectTo(AccountOrdersPage({ searchParams: {} }), "/compte/connexion");
    expect(
      await prismaTest.customerSession.findUnique({ where: { token: "session-perimee" } }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Déconnexion
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/account/logout", () => {
  it("supprime la session en base et efface le cookie", async () => {
    const { cookie } = await signedInCustomer("sortante@shop.local");

    const res = await logoutRoute(request("/api/account/logout", { method: "POST", cookie }));
    expect(res.status).toBe(204);

    expect(await prismaTest.customerSession.count()).toBe(0);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/customer_session=/);
    expect(setCookie).toMatch(/Max-Age=0/i);

    // Même cookie rejoué : la session n'existe plus, la garde redirige.
    cookieJar.set(CUSTOMER_SESSION_COOKIE, cookie.split("=")[1] as string);
    await expectRedirectTo(AccountOrdersPage({ searchParams: {} }), "/compte/connexion");
  });

  it("reste 204 sans session (déconnexion idempotente)", async () => {
    const res = await logoutRoute(request("/api/account/logout", { method: "POST" }));
    expect(res.status).toBe(204);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Isolation des commandes
// ─────────────────────────────────────────────────────────────────────

describe("accès aux commandes", () => {
  it("renvoie 401 sans session sur l'API de détail", async () => {
    const res = await accountOrderGet(request("/api/account/orders/x"), { params: { id: "x" } });
    expect(res.status).toBe(401);
  });

  it("un client ne voit PAS la commande d'un autre (404, pas 200)", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const other = await createGuestCustomer("autre@shop.local", "Bintou", "Diallo");
    const { order: otherOrder, shipment } = await createOrder({
      customerId: other.id,
      variantId: variant.id,
      number: "ORD-2026-000202",
      withShipment: true,
    });

    const { cookie } = await signedInCustomer("curieuse@shop.local");

    const res = await accountOrderGet(request(`/api/account/orders/${otherOrder.id}`, { cookie }), {
      params: { id: otherOrder.id },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    // Aucune donnée de la commande d'autrui ne fuit dans le corps de réponse.
    expect(body).not.toHaveProperty("totalCents");
    expect(JSON.stringify(body)).not.toContain(shipment!.trackingNo);
    expect(JSON.stringify(body)).not.toContain("Bintou");
  });

  it("renvoie le détail complet de SA commande, expédition incluse", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const { customerId, cookie } = await signedInCustomer("proprietaire@shop.local");
    const { order } = await createOrder({
      customerId,
      variantId: variant.id,
      number: "ORD-2026-000203",
      withShipment: true,
    });

    const res = await accountOrderGet(request(`/api/account/orders/${order.id}`, { cookie }), {
      params: { id: order.id },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      items: unknown[];
      shipments: Array<{ trackingNo: string; carrier: string }>;
      totalCents: number;
    };
    expect(body.id).toBe(order.id);
    expect(body.items).toHaveLength(1);
    expect(body.totalCents).toBe(1990 * 2 + 590);
    expect(body.shipments[0]?.trackingNo).toBe("DHL-0001");
    expect(body.shipments[0]?.carrier).toBe("DHL Démo");
  });

  it("la page de détail rend un 404 (notFound) pour la commande d'un autre client", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const other = await createGuestCustomer("autre@shop.local");
    const { order: otherOrder } = await createOrder({
      customerId: other.id,
      variantId: variant.id,
      number: "ORD-2026-000204",
    });

    const { cookie } = await signedInCustomer("curieuse2@shop.local");
    cookieJar.set(CUSTOMER_SESSION_COOKIE, cookie.split("=")[1] as string);

    try {
      await AccountOrderDetailPage({ params: { id: otherOrder.id } });
      expect.unreachable("la page aurait dû rendre un 404");
    } catch (err) {
      const digest = String((err as { digest?: string }).digest ?? "");
      // Next signale `notFound()` par ce marqueur (le nom exact varie selon la
      // version : on accepte les deux formes connues).
      expect(digest.includes("NEXT_NOT_FOUND") || digest.includes("NEXT_HTTP_ERROR_FALLBACK")).toBe(
        true,
      );
    }
  });

  it("la page de détail rend SA commande (avec le suivi d'expédition)", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const { customerId, cookie } = await signedInCustomer("proprietaire2@shop.local");
    const { order } = await createOrder({
      customerId,
      variantId: variant.id,
      number: "ORD-2026-000205",
      status: "SHIPPED",
      withShipment: true,
    });
    cookieJar.set(CUSTOMER_SESSION_COOKIE, cookie.split("=")[1] as string);

    const text = visibleText(await AccountOrderDetailPage({ params: { id: order.id } }));
    expect(text).toContain("DHL-0001");
    expect(text).toContain("DHL Démo");
    expect(text).toContain(order.number);
    expect(text).toContain("Expédition");
  });

  it("la liste ne contient que les commandes du client connecté", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const other = await createGuestCustomer("autre@shop.local");
    await createOrder({
      customerId: other.id,
      variantId: variant.id,
      number: "ORD-2026-000300",
    });

    const { customerId, cookie } = await signedInCustomer("moi@shop.local");
    cookieJar.set(CUSTOMER_SESSION_COOKIE, cookie.split("=")[1] as string);
    await createOrder({
      customerId,
      variantId: variant.id,
      number: "ORD-2026-000301",
    });

    const text = visibleText(await AccountOrdersPage({ searchParams: {} }));
    expect(text).toContain("ORD-2026-000301");
    expect(text).not.toContain("ORD-2026-000300");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Carnet d'adresses
// ─────────────────────────────────────────────────────────────────────

describe("carnet d'adresses", () => {
  const ADDRESS = {
    line1: "12 rue des Lilas",
    city: "Douala",
    postalCode: "00237",
    country: "fr",
  };

  it("renvoie 401 sans session", async () => {
    const list = await addressesGet(request("/api/account/addresses"));
    expect(list.status).toBe(401);

    const create = await addressesPost(
      request("/api/account/addresses", { method: "POST", body: ADDRESS }),
    );
    expect(create.status).toBe(401);
  });

  it("la première adresse créée devient l'adresse par défaut", async () => {
    const { cookie } = await signedInCustomer("carnet@shop.local");

    const res = await addressesPost(
      request("/api/account/addresses", { method: "POST", cookie, body: ADDRESS }),
    );
    expect(res.status).toBe(201);

    const body = (await res.json()) as { address: { id: string; isDefault: boolean; country: string } };
    expect(body.address.isDefault).toBe(true);
    // Le code pays est normalisé en majuscules : `fr` et `FR` sont le même pays,
    // et la valeur part telle quelle dans les emails d'expédition.
    expect(body.address.country).toBe("FR");

    const list = await addressesGet(request("/api/account/addresses", { cookie }));
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { addresses: unknown[] };
    expect(listed.addresses).toHaveLength(1);
  });

  it("définir une autre adresse par défaut retire le drapeau de la précédente", async () => {
    const { cookie } = await signedInCustomer("carnet2@shop.local");

    const first = (await (
      await addressesPost(
        request("/api/account/addresses", { method: "POST", cookie, body: ADDRESS }),
      )
    ).json()) as { address: { id: string } };
    const second = (await (
      await addressesPost(
        request("/api/account/addresses", { method: "POST", cookie, body: { ...ADDRESS, city: "Yaoundé" } }),
      )
    ).json()) as { address: { id: string } };

    const res = await addressPatch(
      request(`/api/account/addresses/${second.address.id}`, {
        method: "PATCH",
        cookie,
        body: { isDefault: true },
      }),
      { params: { id: second.address.id } },
    );
    expect(res.status).toBe(200);

    const rows = await prismaTest.address.findMany({ orderBy: { id: "asc" } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(second.address.id)?.isDefault).toBe(true);
    expect(byId.get(first.address.id)?.isDefault).toBe(false);
  });

  it("refuse de modifier ou supprimer l'adresse d'un autre client (404)", async () => {
    const other = await createGuestCustomer("autre@shop.local");
    const foreign = await prismaTest.address.create({
      data: { customerId: other.id, ...ADDRESS, country: "FR" },
    });

    const { cookie } = await signedInCustomer("intruse@shop.local");

    const patch = await addressPatch(
      request(`/api/account/addresses/${foreign.id}`, {
        method: "PATCH",
        cookie,
        body: { ...ADDRESS, city: "Libreville" },
      }),
      { params: { id: foreign.id } },
    );
    expect(patch.status).toBe(404);

    const del = await addressDelete(
      request(`/api/account/addresses/${foreign.id}`, { method: "DELETE", cookie }),
      { params: { id: foreign.id } },
    );
    expect(del.status).toBe(404);

    const untouched = await prismaTest.address.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.city).toBe("Douala");
  });

  it("refuse de supprimer une adresse citée par une commande (409) et le justifie", async () => {
    const { products } = await seedFixtures();
    const variant = products["t-shirt-basique-blanc"]!.variants[0]!;

    const { customerId, cookie } = await signedInCustomer("utilisee@shop.local");
    const { address } = await createOrder({
      customerId,
      variantId: variant.id,
      number: "ORD-2026-000400",
    });

    const res = await addressDelete(
      request(`/api/account/addresses/${address.id}`, { method: "DELETE", cookie }),
      { params: { id: address.id } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("ADDRESS_IN_USE");
    expect(body.error).toContain("commande");

    expect(await prismaTest.address.findUnique({ where: { id: address.id } })).not.toBeNull();
  });

  it("supprime une adresse libre et promeut l'adresse par défaut suivante", async () => {
    const { cookie } = await signedInCustomer("nettoyage@shop.local");

    const first = (await (
      await addressesPost(
        request("/api/account/addresses", { method: "POST", cookie, body: ADDRESS }),
      )
    ).json()) as { address: { id: string } };
    const second = (await (
      await addressesPost(
        request("/api/account/addresses", { method: "POST", cookie, body: { ...ADDRESS, city: "Bafoussam" } }),
      )
    ).json()) as { address: { id: string } };

    const res = await addressDelete(
      request(`/api/account/addresses/${first.address.id}`, { method: "DELETE", cookie }),
      { params: { id: first.address.id } },
    );
    expect(res.status).toBe(204);

    const rows = await prismaTest.address.findMany({ where: { id: { in: [first.address.id, second.address.id] } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(second.address.id);
    expect(rows[0]!.isDefault).toBe(true);
  });

  it("rejette une adresse incomplète (400) sans rien écrire", async () => {
    const { cookie } = await signedInCustomer("valide@shop.local");

    const res = await addressesPost(
      request("/api/account/addresses", {
        method: "POST",
        cookie,
        body: { line1: "", city: "Douala", postalCode: "00237", country: "FR" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await prismaTest.address.count()).toBe(0);
  });
});
