import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OrderStatus, Role } from "@prisma/client";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

// `cookies()` n'existe pas hors d'une requête Next : pages et
// `lib/customer-auth` en ont besoin pour lire la session client.
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

import { POST as submitReviewRoute } from "@/app/api/account/reviews/route";
import { PATCH as moderateReviewRoute } from "@/app/api/admin/reviews/[id]/route";
import ProductDetailPage from "@/app/(shop)/products/[slug]/page";
import OrderReviewPage from "@/app/(shop)/compte/commandes/[id]/avis/page";
import { hashPassword } from "@/lib/auth";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-auth";
import { newId } from "@/lib/ids";
import { generateOrderAccessToken } from "@/lib/order-token";
import { ReviewsSection } from "@/ui/components/product-reviews";
import {
  countPendingReviews,
  getProductRatingSummary,
  listModerationQueue,
  listOrderReviewCandidates,
  listPublishedReviews,
} from "@/server/reviews";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";

/**
 * Avis clients modérés (chantier F) — intégration sur la vraie base `shop_test`.
 *
 * LE TEST LE PLUS IMPORTANT DE CE FICHIER : « un client ne peut pas déposer un
 * avis sur la commande d'un autre ». On vérifie un REFUS, pas un succès : c'est
 * la faille classique de cette fonctionnalité (un `orderId` reçu en paramètre
 * et utilisé sans vérifier à qui il appartient), et un test qui se contente de
 * montrer que « ça marche » ne la détecte pas.
 *
 * Les autres verrous : rien n'est public en `PENDING` (même par la page
 * produit), la moyenne ne compte que les `APPROVED`, l'approbation journalise,
 * et une commande sans avis n'affiche aucun bloc de note (état vide honnête).
 */

const BASE = "http://localhost:3000";

function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie) headers.cookie = options.cookie;

  return new NextRequest(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

/** Client + session ouverte (le cookie est renvoyé prêt à l'emploi). */
async function customerSession(
  email: string,
  name = { firstName: "Aïcha", lastName: "Ndiaye" },
): Promise<{ customerId: string; cookie: string }> {
  const customer = await prismaTest.customer.create({
    data: { email, firstName: name.firstName, lastName: name.lastName },
  });
  const token = newId();
  await prismaTest.customerSession.create({
    data: { token, customerId: customer.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { customerId: customer.id, cookie: `${CUSTOMER_SESSION_COOKIE}=${token}` };
}

/** Utilisateur interne + session admin/STAFF. */
async function staffSession(
  role: Role,
  email = `${role.toLowerCase()}-${newId().slice(0, 8)}@shop.local`,
): Promise<{ token: string; userId: string }> {
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
  return { token, userId: user.id };
}

/** Commande d'un client avec UNE ligne (le produit commandé). */
async function createOrder(params: {
  customerId: string;
  variantId: string;
  number: string;
  status?: OrderStatus;
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

  return prismaTest.order.create({
    data: {
      number: params.number,
      accessToken: generateOrderAccessToken(),
      customerId: params.customerId,
      addressId: address.id,
      status: params.status ?? "DELIVERED",
      subtotalCents: 1_990,
      shippingCents: 590,
      totalCents: 2_580,
      paymentProvider: "mock",
      items: {
        create: [
          {
            variantId: params.variantId,
            quantity: 1,
            unitPriceCents: 1_990,
            productNameSnapshot: "T-shirt basique blanc",
            variantNameSnapshot: "Blanc / S",
          },
        ],
      },
    },
  });
}

/** Texte visible d'un arbre React, sans rendu DOM (même helper que l'espace client). */
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

/**
 * Types d'éléments présents dans l'arbre React.
 *
 * Sert à vérifier une affirmation négative autrement impossible à tester :
 * « aucun élément `<script>`/`<a>` n'est produit à partir d'un avis ». Un test
 * qui ne regarde que le texte visible ne voit pas une balise introduite dans le
 * DOM.
 */
function elementTypes(node: unknown, found: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) elementTypes(child, found);
    return found;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (typeof element.type === "string") found.push(element.type);
  else if (typeof element.type === "function") {
    found.push((element.type as { name?: string }).name ?? "anonymous");
  }
  elementTypes(element.props?.children, found);
  return found;
}

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────
// Dépôt d'un avis (F2)
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/account/reviews", () => {
  it("refuse une requête sans session client (401)", async () => {
    const res = await submitReviewRoute(
      request("/api/account/reviews", {
        method: "POST",
        body: { orderId: "x", productId: "y", rating: 5, body: "très bon produit", authorName: "Aïcha" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("REFUSE un avis sur la commande d'un AUTRE client, et n'écrit rien", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const variant = product.variants[0]!;

    // La victime a bien commandé l'article…
    const victime = await customerSession("victime@shop.local");
    const order = await createOrder({
      customerId: victime.customerId,
      variantId: variant.id,
      number: "ORD-2026-000401",
    });

    // …et l'attaquant est un client légitime de la boutique, connecté, qui
    // présente l'`orderId` de quelqu'un d'autre (id deviné ou intercepté).
    const attaquant = await customerSession("attaquant@shop.local");
    const res = await submitReviewRoute(
      request("/api/account/reviews", {
        method: "POST",
        cookie: attaquant.cookie,
        body: {
          orderId: order.id,
          productId: product.id,
          rating: 5,
          body: "Achat vérifié selon moi, article parfait et livraison rapide.",
          authorName: "Faux client",
        },
      }),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("ORDER_NOT_FOUND");

    // La preuve : rien n'a été écrit, ni pour la victime ni pour l'attaquant.
    expect(await prismaTest.review.count()).toBe(0);
    const summary = await getProductRatingSummary(product.id);
    expect(summary).toBeNull();
  });

  it("refuse un produit qui ne fait pas partie de la commande (422)", async () => {
    const { products } = await seedFixtures();
    const ordered = products["t-shirt-basique-blanc"]!;
    const notOrdered = products["sac-tote-canvas"]!;

    const { customerId, cookie } = await customerSession("cliente@shop.local");
    const order = await createOrder({
      customerId,
      variantId: ordered.variants[0]!.id,
      number: "ORD-2026-000402",
    });

    const res = await submitReviewRoute(
      request("/api/account/reviews", {
        method: "POST",
        cookie,
        body: {
          orderId: order.id,
          productId: notOrdered.id,
          rating: 4,
          body: "Je n'ai pas acheté ce sac mais je donne quand même mon avis.",
          authorName: "Aïcha",
        },
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PRODUCT_NOT_ORDERED");
    expect(await prismaTest.review.count()).toBe(0);
  });

  it("refuse une commande annulée et une commande remboursée (422)", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;

    for (const [index, status] of (["CANCELLED", "REFUNDED"] as OrderStatus[]).entries()) {
      const { customerId, cookie } = await customerSession(`cliente-${index}@shop.local`);
      const order = await createOrder({
        customerId,
        variantId: product.variants[0]!.id,
        number: `ORD-2026-00050${index}`,
        status,
      });

      const res = await submitReviewRoute(
        request("/api/account/reviews", {
          method: "POST",
          cookie,
          body: {
            orderId: order.id,
            productId: product.id,
            rating: 1,
            body: "Commande annulée mais je tiens à m'exprimer malgré tout.",
            authorName: "Aïcha",
          },
        }),
      );

      expect(res.status, `statut ${status}`).toBe(422);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("ORDER_CANCELLED");
    }

    expect(await prismaTest.review.count()).toBe(0);
  });

  it("refuse une saisie invalide (400) sans rien écrire", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const { customerId, cookie } = await customerSession("cliente@shop.local");
    const order = await createOrder({
      customerId,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000403",
    });

    const res = await submitReviewRoute(
      request("/api/account/reviews", {
        method: "POST",
        cookie,
        body: { orderId: order.id, productId: product.id, rating: 9, body: "court", authorName: "A" },
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; details?: Array<{ field: string }> };
    expect(body.code).toBe("INVALID_INPUT");
    expect(body.details?.map((d) => d.field).sort()).toEqual(["authorName", "body", "rating"]);
    expect(await prismaTest.review.count()).toBe(0);
  });

  it("accepte un avis sur un produit réellement acheté : PENDING + message d'attente", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const { customerId, cookie } = await customerSession("cliente@shop.local");
    const order = await createOrder({
      customerId,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000404",
    });

    const res = await submitReviewRoute(
      request("/api/account/reviews", {
        method: "POST",
        cookie,
        body: {
          orderId: order.id,
          productId: product.id,
          rating: 5,
          title: "Coupe parfaite",
          body: "La coupe est fidèle à la photo et la livraison a été rapide.",
          authorName: "Aïcha N.",
        },
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { review?: { id: string; status: string }; message?: string };
    expect(body.review?.status).toBe("PENDING");
    expect(body.message).toContain("Merci, votre avis sera publié après vérification");

    const stored = await prismaTest.review.findUniqueOrThrow({
      where: { id: body.review!.id },
    });
    expect(stored.status).toBe("PENDING");
    expect(stored.orderId).toBe(order.id);
    expect(stored.customerId).toBe(customerId);
    expect(stored.moderatedAt).toBeNull();
    expect(stored.moderatedById).toBeNull();
  });

  it("refuse un doublon avec un message clair (409), même après un rejet", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const { customerId, cookie } = await customerSession("cliente@shop.local");
    const order = await createOrder({
      customerId,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000405",
    });

    const payload = {
      orderId: order.id,
      productId: product.id,
      rating: 4,
      body: "Article conforme, je recommande cette boutique sans hésiter.",
      authorName: "Aïcha N.",
    };

    const first = await submitReviewRoute(
      request("/api/account/reviews", { method: "POST", cookie, body: payload }),
    );
    expect(first.status).toBe(201);

    const second = await submitReviewRoute(
      request("/api/account/reviews", { method: "POST", cookie, body: payload }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { code?: string; error?: string };
    expect(body.code).toBe("ALREADY_REVIEWED");
    // Un message compréhensible, jamais « erreur serveur ».
    expect(body.error).toMatch(/déjà déposé un avis/i);
    expect(await prismaTest.review.count()).toBe(1);

    // Rejeter le premier avis ne rend pas le droit d'en déposer un second :
    // la contrainte d'unicité porte sur (produit, client), pas sur le statut.
    const staffAdmin = await staffSession("ADMIN");
    const reviewId = (await prismaTest.review.findFirstOrThrow()).id;
    const rejected = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${staffAdmin.token}`,
        body: { decision: "reject", reason: "hors sujet" },
      }),
      { params: { id: reviewId } },
    );
    expect(rejected.status).toBe(200);

    const third = await submitReviewRoute(
      request("/api/account/reviews", { method: "POST", cookie, body: payload }),
    );
    expect(third.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Publication (F1)
// ─────────────────────────────────────────────────────────────────────

describe("visibilité publique des avis", () => {
  async function seedReview(params: {
    productId: string;
    variantId: string;
    number: string;
    rating: number;
    body: string;
    email: string;
  }) {
    const { customerId, cookie } = await customerSession(params.email);
    const order = await createOrder({
      customerId,
      variantId: params.variantId,
      number: params.number,
    });
    const res = await submitReviewRoute(
      request("/api/account/reviews", {
        method: "POST",
        cookie,
        body: {
          orderId: order.id,
          productId: params.productId,
          rating: params.rating,
          body: params.body,
          authorName: params.email.split("@")[0] ?? "Client",
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { review: { id: string } };
    return body.review.id;
  }

  it("un avis PENDING n'apparaît NI dans la liste publique NI sur la fiche produit", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;

    await seedReview({
      productId: product.id,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000601",
      rating: 5,
      body: "Un avis en attente qui ne doit pas être publié avant approbation.",
      email: "attente@shop.local",
    });

    const page = await ProductDetailPage({ params: { slug: product.slug } });
    const text = visibleText(page);
    expect(text).not.toContain("attente");
    expect(text).not.toContain("Un avis en attente");
    // `visibleText` ne déplie pas les composants-fonctions (il parcourt les
    // enfants JSX déjà construits, il ne « rend » pas) : l'absence du bloc
    // d'avis se vérifie donc sur la STRUCTURE de l'arbre, et son contenu sur le
    // composant lui-même, nourri de la donnée réellement calculée.
    expect(elementTypes(page)).not.toContain("ReviewsSection");
    expect(elementTypes(page)).not.toContain("script");
    expect(
      ReviewsSection({
        productName: product.slug,
        summary: null,
        reviews: [],
        page: 1,
        pageCount: 1,
        productHref: `/products/${product.slug}`,
      }),
    ).toBeNull();

    const published = await listPublishedReviews(product.id);
    expect(published.total).toBe(0);
    expect(published.reviews).toHaveLength(0);
    expect(await getProductRatingSummary(product.id)).toBeNull();
  });

  it("un produit sans avis n'affiche rien : ni 0/0, ni 0,0, ni étoiles vides", async () => {
    const { products } = await seedFixtures();

    const page = await ProductDetailPage({ params: { slug: products["sac-tote-canvas"]!.slug } });
    const text = visibleText(page);

    expect(text).not.toContain("Avis clients");
    expect(text).not.toContain("0,0");
    expect(text).not.toContain("0 avis");
    expect(text).not.toContain("★");
    // Ni bloc d'avis, ni balisage structuré annonçant une note inexistante.
    expect(elementTypes(page)).not.toContain("ReviewsSection");
    expect(elementTypes(page)).not.toContain("script");
  });

  it("après approbation l'avis est public, la note affichée et la moyenne calculée", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;

    const approvedId = await seedReview({
      productId: product.id,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000602",
      rating: 5,
      body: "Excellent t-shirt, la matière est douce et la taille est juste.",
      email: "contente@shop.local",
    });
    await seedReview({
      productId: product.id,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000603",
      rating: 1,
      body: "Avis très négatif qui doit rester invisible tant qu'il n'est pas modéré.",
      email: "en-attente@shop.local",
    });

    const staff = await staffSession("STAFF");
    const res = await moderateReviewRoute(
      request(`/api/admin/reviews/${approvedId}`, {
        method: "PATCH",
        cookie: `admin_session=${staff.token}`,
        body: { decision: "approve" },
      }),
      { params: { id: approvedId } },
    );
    expect(res.status).toBe(200);

    // La moyenne ne compte QUE l'avis approuvé : 5, pas 3 (moyenne des deux).
    const summary = await getProductRatingSummary(product.id);
    expect(summary?.count).toBe(1);
    expect(summary?.average).toBe(5);

    const page = await ProductDetailPage({ params: { slug: product.slug } });
    // Structure : le bloc d'avis EST sur la fiche (composant monté).
    expect(elementTypes(page)).toContain("ReviewsSection");
    // Contenu : rendu du composant avec la donnée réellement calculée par le
    // serveur (note, liste publiée), c'est-à-dire exactement ce que voit Marc.
    const reviewed = await listPublishedReviews(product.id);
    const section = ReviewsSection({
      productName: "T-shirt basique blanc",
      summary,
      reviews: reviewed.reviews,
      page: reviewed.page,
      pageCount: reviewed.pageCount,
      productHref: `/products/${product.slug}`,
    });
    const sectionText = visibleText(section);
    // `visibleText` joint les enfants JSX par un espace : on normalise les
    // espaces pour comparer le texte tel qu'il sera lu à l'écran.
    const flatSection = sectionText.replace(/\s+/g, " ");
    expect(flatSection).toContain("Avis clients");
    expect(flatSection).toContain("5,0");
    expect(flatSection).toContain("sur 1 avis publié");
    expect(flatSection).toContain("Achat vérifié");
    expect(flatSection).toContain("Excellent t-shirt");
    expect(flatSection).not.toContain("doit rester invisible");

    // Balisage structuré : présent sur la fiche puisqu'il y a un avis publié.
    expect(elementTypes(page)).toContain("script");
  });

  it("après rejet l'avis reste invisible et n'entre dans aucune moyenne", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;

    const rejectedId = await seedReview({
      productId: product.id,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000604",
      rating: 1,
      body: "Propos que la boutique refuse de publier, hors sujet et désagréable envers un autre client.",
      email: "rejet@shop.local",
    });

    const admin = await staffSession("ADMIN");
    const res = await moderateReviewRoute(
      request(`/api/admin/reviews/${rejectedId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "reject", reason: "contenu publicitaire" },
      }),
      { params: { id: rejectedId } },
    );
    expect(res.status).toBe(200);

    expect(await getProductRatingSummary(product.id)).toBeNull();
    const page = await ProductDetailPage({ params: { slug: product.slug } });
    const text = visibleText(page);
    expect(text).not.toContain("Avis clients");
    expect(text).not.toContain("Propos que la boutique refuse");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Modération (F3)
// ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/reviews/[id]", () => {
  async function pendingReview(): Promise<{ reviewId: string; productId: string }> {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const { customerId } = await customerSession("cliente@shop.local");
    const order = await createOrder({
      customerId,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000701",
    });
    const review = await prismaTest.review.create({
      data: {
        productId: product.id,
        customerId,
        orderId: order.id,
        authorName: "Aïcha N.",
        rating: 4,
        title: "Bien reçu",
        body: "Article reçu rapidement, conforme à la description et bien emballé.",
        status: "PENDING",
      },
    });
    return { reviewId: review.id, productId: product.id };
  }

  it("refuse une requête sans session (401), puis accepte un ADMIN", async () => {
    const { reviewId } = await pendingReview();

    const anonymous = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        body: { decision: "approve" },
      }),
      { params: { id: reviewId } },
    );
    expect(anonymous.status).toBe(401);

    const admin = await staffSession("ADMIN");
    const ok = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "approve" },
      }),
      { params: { id: reviewId } },
    );
    expect(ok.status).toBe(200);
  });

  it("accepte un STAFF (capacité reviews:moderate portée par les deux rôles)", async () => {
    const { reviewId } = await pendingReview();
    const staff = await staffSession("STAFF");

    const res = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${staff.token}`,
        body: { decision: "approve" },
      }),
      { params: { id: reviewId } },
    );
    expect(res.status).toBe(200);
  });

  it("l'approbation écrit moderatedById + moderatedAt ET journalise dans AuditLog", async () => {
    const { reviewId } = await pendingReview();
    const admin = await staffSession("ADMIN");

    const res = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "approve" },
      }),
      { params: { id: reviewId } },
    );
    expect(res.status).toBe(200);

    const stored = await prismaTest.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(stored.status).toBe("APPROVED");
    expect(stored.moderatedById).toBe(admin.userId);
    expect(stored.moderatedAt).not.toBeNull();

    const log = await prismaTest.auditLog.findFirst({
      where: { entity: "Review", entityId: reviewId },
    });
    expect(log).not.toBeNull();
    expect(log?.action).toBe("review.approve");
    expect(log?.userId).toBe(admin.userId);
    const diff = log?.diff as { from?: string; to?: string } | null;
    expect(diff?.from).toBe("PENDING");
    expect(diff?.to).toBe("APPROVED");
  });

  it("le rejet journalise le motif libre (il n'y a pas de colonne pour lui)", async () => {
    const { reviewId } = await pendingReview();
    const admin = await staffSession("ADMIN");

    const res = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "reject", reason: "propos injurieux envers un autre client" },
      }),
      { params: { id: reviewId } },
    );
    expect(res.status).toBe(200);

    const stored = await prismaTest.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(stored.status).toBe("REJECTED");

    const log = await prismaTest.auditLog.findFirstOrThrow({
      where: { entity: "Review", entityId: reviewId },
    });
    expect(log.action).toBe("review.reject");
    expect((log.diff as { reason?: string }).reason).toBe("propos injurieux envers un autre client");
  });

  it("refuse de modérer deux fois le même avis (409) et rend 404 sur un avis inconnu", async () => {
    const { reviewId } = await pendingReview();
    const admin = await staffSession("ADMIN");

    const first = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "approve" },
      }),
      { params: { id: reviewId } },
    );
    expect(first.status).toBe(200);

    const second = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "reject" },
      }),
      { params: { id: reviewId } },
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code?: string }).code).toBe("ALREADY_MODERATED");

    // Un seul AuditLog : la seconde décision n'a rien écrit.
    expect(await prismaTest.auditLog.count({ where: { entityId: reviewId } })).toBe(1);

    const unknown = await moderateReviewRoute(
      request("/api/admin/reviews/inconnu", {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "approve" },
      }),
      { params: { id: "inconnu" } },
    );
    expect(unknown.status).toBe(404);
  });

  it("refuse une décision invalide (400)", async () => {
    const { reviewId } = await pendingReview();
    const admin = await staffSession("ADMIN");

    const res = await moderateReviewRoute(
      request(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        cookie: `admin_session=${admin.token}`,
        body: { decision: "publier" },
      }),
      { params: { id: reviewId } },
    );
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
// File de modération (F3, KPI K8)
// ─────────────────────────────────────────────────────────────────────

describe("file de modération", () => {
  it("ne contient que les PENDING, les plus anciens d'abord, et compte les retards", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;

    const old = await prismaTest.review.create({
      data: {
        productId: product.id,
        authorName: "Ancienne",
        rating: 3,
        body: "Avis déposé il y a longtemps et toujours pas modéré, ce qui est le vrai risque.",
        status: "PENDING",
        createdAt: new Date(Date.now() - 9 * 86_400_000),
      },
    });
    await prismaTest.review.create({
      data: {
        productId: product.id,
        authorName: "Récente",
        rating: 5,
        body: "Avis déposé ce matin, dans les délais de modération attendus par la boutique.",
        status: "PENDING",
        createdAt: new Date(),
      },
    });
    await prismaTest.review.create({
      data: {
        productId: product.id,
        authorName: "Publiée",
        rating: 5,
        body: "Avis déjà approuvé qui ne doit pas apparaître dans la file d'attente.",
        status: "APPROVED",
      },
    });

    const queue = await listModerationQueue({});
    expect(queue.rows.map((row) => row.authorName)).toEqual(["Ancienne", "Récente"]);

    const counters = await countPendingReviews();
    expect(counters.pending).toBe(2);
    expect(counters.overdue).toBe(1);

    const published = await listPublishedReviews(product.id);
    expect(published.reviews.map((row) => row.authorName)).toEqual(["Publiée"]);

    // Le seuil du KPI K8 est bien celui de la file : l'avis de 9 jours est
    // compté en retard, celui du jour non.
    expect(queue.rows.find((row) => row.id === old.id)?.createdAt.getTime()).toBeLessThan(
      Date.now() - 7 * 86_400_000,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Espace client : de quoi ai-je le droit de parler ? (F2)
// ─────────────────────────────────────────────────────────────────────

describe("page « Laisser un avis » de l'espace client", () => {
  it("propose les articles non notés et explique l'état des avis déjà déposés", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const { customerId, cookie } = await customerSession("compte@shop.local");
    const order = await createOrder({
      customerId,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000801",
    });

    cookieJar.set(CUSTOMER_SESSION_COOKIE, cookie.split("=")[1] as string);

    // Avant tout avis : le formulaire est proposé (le nom du produit est une
    // copie de `Variant.productNameSnapshot`/`Product.name` ; le helper de seed
    // ne renvoie pas le nom, on l'écrit en clair).
    const before = await OrderReviewPage({ params: { id: order.id } });
    expect(visibleText(before)).toContain("T-shirt basique blanc");
    expect(visibleText(before)).toContain("Laisser un avis");
    expect(visibleText(before)).toContain("Achat vérifié");

    // Après dépôt : plus de formulaire, un état lisible.
    await prismaTest.review.create({
      data: {
        productId: product.id,
        customerId,
        orderId: order.id,
        authorName: "Aïcha",
        rating: 5,
        body: "Article parfaitement conforme, livraison rapide, je recommande vivement.",
      },
    });
    const after = await OrderReviewPage({ params: { id: order.id } });
    const text = visibleText(after);
    expect(text).toContain("En attente de vérification");
    // Plus de formulaire : ses libellés de champs ont disparu (le texte
    // « Votre avis… » de l'état d'attente, lui, reste — c'est le message
    // d'accusé de réception, pas un champ).
    expect(text).not.toContain("Nom affiché");
    expect(text).not.toContain("Titre (facultatif)");
  });

  it("rend un 404 pour la commande d'un autre client (aucune fuite)", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const victime = await customerSession("victime2@shop.local");
    const order = await createOrder({
      customerId: victime.customerId,
      variantId: product.variants[0]!.id,
      number: "ORD-2026-000802",
    });

    const curieuse = await customerSession("curieuse@shop.local");
    cookieJar.set(CUSTOMER_SESSION_COOKIE, curieuse.cookie.split("=")[1] as string);

    try {
      await OrderReviewPage({ params: { id: order.id } });
      expect.unreachable("la page aurait dû rendre un 404");
    } catch (err) {
      const digest = String((err as { digest?: string }).digest ?? "");
      expect(
        digest.includes("NEXT_NOT_FOUND") || digest.includes("NEXT_HTTP_ERROR_FALLBACK"),
      ).toBe(true);
    }

    // Le service confirme aussi le cloisonnement (défense en profondeur).
    expect(await listOrderReviewCandidates(curieuse.customerId, order.id)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Contrainte d'unicité et sémantique NULL de PostgreSQL
// ─────────────────────────────────────────────────────────────────────

describe("contrainte @@unique([productId, customerId])", () => {
  it("refuse deux avis du même client sur le même produit au niveau de la BASE", async () => {
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;
    const { customerId } = await customerSession("doublon@shop.local");

    await prismaTest.review.create({
      data: {
        productId: product.id,
        customerId,
        authorName: "Aïcha",
        rating: 5,
        body: "Premier avis, écrit en base directement pour tester la contrainte.",
      },
    });

    await expect(
      prismaTest.review.create({
        data: {
          productId: product.id,
          customerId,
          authorName: "Aïcha",
          rating: 1,
          body: "Second avis du même client sur le même produit : la base doit refuser.",
        },
      }),
    ).rejects.toThrow();
  });

  it("DOCUMENTE la faille NULL : deux avis sans clientId sur le même produit coexistent", async () => {
    // En PostgreSQL, `NULL` n'est jamais égal à `NULL` : une contrainte unique
    // sur une colonne NULLABLE n'interdit pas deux lignes à NULL. Le schéma
    // étant gelé pendant la vague 2, on ne peut pas le corriger ici — on le
    // PROUVE, pour que personne ne croie que la contrainte protège ce cas.
    //
    // Pourquoi c'est inoffensif en pratique : la seule porte d'écriture
    // publique (`submitReview`) exige une session client et écrit TOUJOURS un
    // `customerId` non nul (et un `orderId` non nul). Deux avis anonymes sur le
    // même produit ne peuvent donc venir que d'une insertion manuelle en base.
    const { products } = await seedFixtures();
    const product = products["t-shirt-basique-blanc"]!;

    await prismaTest.review.create({
      data: {
        productId: product.id,
        customerId: null,
        orderId: null,
        authorName: "Anonyme 1",
        rating: 5,
        body: "Avis sans client (cas théorique) écrit directement en base pour la démonstration.",
      },
    });
    await prismaTest.review.create({
      data: {
        productId: product.id,
        customerId: null,
        orderId: null,
        authorName: "Anonyme 2",
        rating: 1,
        body: "Second avis sans client sur le même produit : PostgreSQL l'accepte.",
      },
    });

    expect(await prismaTest.review.count({ where: { productId: product.id } })).toBe(2);
  });
});
