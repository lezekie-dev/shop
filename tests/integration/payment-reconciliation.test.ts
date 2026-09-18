import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import React from "react";
import type { OrderStatus, PaymentStatus } from "@prisma/client";

// Vitest transforme le JSX en `React.createElement` (mode « classic ») alors que
// les pages Next n'importent pas React : sans cette affectation, le rendu réel
// de la page lève « React is not defined ».
(globalThis as unknown as { React: unknown }).React = React;

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

// `cookies()` n'existe pas hors d'une requête Next : on fournit le strict
// nécessaire (get/set) pour que la page admin soit exécutable telle quelle.
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

import { POST as cronReconcile } from "@/app/api/cron/reconcile-payments/route";
import { POST as adminReconcile } from "@/app/api/admin/payments/[id]/reconcile/route";
import { POST as markPaid } from "@/app/api/admin/orders/[id]/mark-paid/route";
import { POST as mmCallback } from "@/app/api/payments/mobile-money/callback/route";
import AdminPaymentsPage from "@/app/(admin)/admin/paiements/page";
import { DataTable } from "@/ui/components/admin/data-table";
import { PaymentActions } from "@/ui/components/admin/payment-actions";
import { RECONCILE_MAX_ATTEMPTS } from "@/domain/payment/reconciliation";
import type { PaymentProvider } from "@/domain/payment/provider";
import { newId } from "@/lib/ids";
import { generateOrderAccessToken } from "@/lib/order-token";
import {
  countStalePendingPayments,
  listPendingPayments,
} from "@/server/admin-payments";
import {
  reconcilePaymentById,
  runPaymentReconciliationJob,
} from "@/server/payment-reconciliation";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";

/**
 * Réconciliation des paiements bloqués (chantier I, lot 2A).
 *
 * Ce qui est prouvé ici, et pas supposé :
 *  - rejouer la réconciliation ne double NI le décrément de stock NI l'email ;
 *  - un paiement confirmé par un callback ne peut pas être rétrogradé ;
 *  - le backoff progresse et plafonne à 24 h (valeurs réelles en base) ;
 *  - au bout des tentatives, RIEN n'est décidé automatiquement (décision D6) ;
 *  - un `JobRun` est écrit à chaque exécution, y compris en échec ;
 *  - la route de cron exige son secret, et STAFF ne peut pas encaisser.
 *
 * Le style suit `tests/integration/payment-flows.test.ts` : Prisma réel sur
 * `shop_test`, truncate entre chaque test, aucun PSP réel.
 */

const ADMIN_COOKIE = "admin_session";

// ─────────────────────────────────────────────────────────────────────
// Fabriques
// ─────────────────────────────────────────────────────────────────────

let seq = 0;

/**
 * Seed partagé par les fabriques d'UN MÊME test.
 *
 * `seedFixtures()` remet `Stock.reserved` à 0 : l'appeler deux fois dans le même
 * test effacerait la réservation posée par la première fabrique, et un test sur
 * la réservation deviendrait vert pour la mauvaise raison. On ne seed donc
 * qu'une fois, et on mémorise le résultat.
 */
let seeded: Awaited<ReturnType<typeof seedFixtures>> | null = null;

async function sharedFixtures(): Promise<Awaited<ReturnType<typeof seedFixtures>>> {
  seeded ??= await seedFixtures();
  return seeded;
}

type Fixture = {
  orderId: string;
  paymentId: string;
  orderNumber: string;
  variantId: string;
  totalCents: number;
};

/**
 * Commande PENDING_PAYMENT + Payment PENDING, dans l'état exact que laisse un
 * checkout : stock RÉSERVÉ (pas décrémenté), paiement en attente, référence
 * encodant le verdict du fournisseur simulé (`mock_*`, `mm_*`, `bt_*`).
 */
async function makePendingPayment(
  options: {
    provider?: string;
    providerRef?: string;
    quantity?: number;
    orderStatus?: OrderStatus;
    paymentStatus?: PaymentStatus;
    reconcileAttempts?: number;
    nextReconcileAt?: Date | null;
    createdAt?: Date;
  } = {},
): Promise<Fixture> {
  const { products } = await sharedFixtures();
  seq += 1;

  // Une variante DIFFÉRENTE par fabrique : deux commandes en attente ne doivent
  // pas se disputer la même ligne de stock, sinon on ne saurait plus laquelle a
  // réservé quoi (et un test « le stock reste réservé » passerait par accident).
  const allVariants = Object.values(products).flatMap((product) => product.variants);
  const variant = allVariants[seq % allVariants.length]!;
  const quantity = options.quantity ?? 1;
  const totalCents = quantity * variant.priceCents;
  const provider = options.provider ?? "mock";
  const providerRef = options.providerRef ?? `mock_ok_${newId()}`;

  // La réservation se POSE (elle ne s'écrase pas) : c'est le geste du checkout
  // qu'on cherche justement à ne pas casser.
  const stock = await prismaTest.stock.findUniqueOrThrow({ where: { variantId: variant.id } });
  await prismaTest.stock.update({
    where: { variantId: variant.id },
    data: { reserved: stock.reserved + quantity },
  });

  const customer = await prismaTest.customer.create({
    data: {
      email: `acheteuse-${seq}@shop.local`,
      firstName: "Aïcha",
      lastName: "Ndiaye",
      phone: "+237600000000",
    },
  });
  const address = await prismaTest.address.create({
    data: {
      customerId: customer.id,
      line1: "12 rue des Lilas",
      city: "Douala",
      postalCode: "00237",
      country: "FR",
    },
  });

  const orderNumber = `ORD-2026-${String(100000 + seq)}`;
  const order = await prismaTest.order.create({
    data: {
      number: orderNumber,
      accessToken: generateOrderAccessToken(),
      customerId: customer.id,
      addressId: address.id,
      status: options.orderStatus ?? "PENDING_PAYMENT",
      subtotalCents: totalCents,
      shippingCents: 0,
      totalCents,
      currency: "EUR",
      paymentProvider: provider,
      paymentRef: providerRef,
      items: {
        create: [
          {
            variantId: variant.id,
            quantity,
            unitPriceCents: variant.priceCents,
            productNameSnapshot: "T-shirt basique blanc",
            variantNameSnapshot: "Blanc / S",
          },
        ],
      },
      payments: {
        create: [
          {
            provider,
            providerRef,
            amountCents: totalCents,
            currency: "EUR",
            status: options.paymentStatus ?? "PENDING",
            reconcileAttempts: options.reconcileAttempts ?? 0,
            nextReconcileAt: options.nextReconcileAt ?? null,
            ...(options.createdAt ? { createdAt: options.createdAt } : {}),
          },
        ],
      },
    },
    include: { payments: true },
  });

  return {
    orderId: order.id,
    paymentId: order.payments[0]!.id,
    orderNumber,
    variantId: variant.id,
    totalCents,
  };
}

async function readOrder(orderId: string) {
  return prismaTest.order.findUniqueOrThrow({ where: { id: orderId } });
}

async function readPayment(paymentId: string) {
  return prismaTest.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

async function readStock(variantId: string) {
  return prismaTest.stock.findUniqueOrThrow({ where: { variantId } });
}

/** Session interne valide (cookie `admin_session`). */
async function staffSession(role: "ADMIN" | "STAFF"): Promise<{ token: string; userId: string }> {
  const user = await prismaTest.user.create({
    data: {
      email: `${role.toLowerCase()}-${newId()}@shop.local`,
      passwordHash: "hash-de-test",
      role,
    },
  });
  const token = newId();
  await prismaTest.session.create({
    data: { token, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { token, userId: user.id };
}

/** Fournisseur factice : c'est le seul moyen de simuler une réponse QUI CHANGE. */
function stubProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: "stub",
    createIntent: async () => ({ providerRef: "stub_ref" }),
    capture: async () => ({ status: "succeeded" }),
    refund: async () => ({ refundRef: "re_stub", status: "succeeded" }),
    verifyWebhook: async () => {
      throw new Error("verifyWebhook non utilisé dans ce test");
    },
    ...overrides,
  };
}

function cronRequest(secret?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/reconcile-payments", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  });
}

function reconcileRequest(paymentId: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/payments/${paymentId}/reconcile`, {
    method: "POST",
    headers: token ? { cookie: `${ADMIN_COOKIE}=${token}` } : {},
  });
}

function markPaidRequest(orderId: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}/mark-paid`, {
    method: "POST",
    headers: token ? { cookie: `${ADMIN_COOKIE}=${token}` } : {},
  });
}

function callbackRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/payments/mobile-money/callback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mock-signature": "t=demo,v1=simulated",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Développe les composants SERVEUR de l'arbre, pour lire ce que le navigateur
 * recevrait vraiment.
 *
 * POURQUOI CE DÉVELOPPEMENT EST NÉCESSAIRE : la page rend `<DataTable … />`, un
 * composant serveur. Tant qu'on ne l'appelle pas, l'arbre s'arrête sur
 * l'élément et le texte des cellules (numéro de commande, badges) reste
 * invisible — on croirait que la page n'affiche rien.
 *
 * On ne développe QUE les composants déclarés ici, et jamais un composant
 * client : `PaymentActions` appelle `useState`/`useRouter`, donc l'appeler hors
 * d'un rendu React lèverait « Invalid hook call ». Il est justement ce qu'on
 * veut INSPECTER (props décidées côté serveur), pas exécuter.
 */
function expandServerComponents(
  node: unknown,
  expandable: readonly unknown[],
): unknown {
  if (Array.isArray(node)) return node.map((child) => expandServerComponents(child, expandable));
  if (node === null || typeof node !== "object" || !("type" in node)) return node;

  const element = node as { type: unknown; props: Record<string, unknown> };
  if (typeof element.type === "function" && expandable.includes(element.type)) {
    const rendered = (element.type as (props: unknown) => unknown)(element.props);
    return expandServerComponents(rendered, expandable);
  }
  return {
    ...element,
    props: {
      ...element.props,
      children: expandServerComponents(element.props.children, expandable),
    },
  };
}

/** Texte visible d'un arbre d'éléments React, sans rendu DOM (cf. espace client). */
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

/** Éléments d'un type donné dans l'arbre — pour lire les props décidées côté serveur. */
function findElements(node: unknown, type: unknown): Array<{ props: Record<string, unknown> }> {
  const found: Array<{ props: Record<string, unknown> }> = [];
  const walk = (current: unknown): void => {
    if (current === null || current === undefined || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    const element = current as { type?: unknown; props?: Record<string, unknown> };
    if (element.type === type && element.props) found.push({ props: element.props });
    if (element.props) walk(element.props.children);
  };
  walk(node);
  return found;
}

async function expectRedirect(promise: Promise<unknown>, path: string): Promise<void> {
  try {
    await promise;
    expect.unreachable("la page aurait dû rediriger l'appelant");
  } catch (err) {
    const digest = String((err as { digest?: string }).digest ?? "");
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain(path);
  }
}

const INITIAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  seeded = null;
  seq = 0;
});

afterEach(() => {
  // On restitue le secret tel qu'il était : d'autres tests du fichier en
  // dépendent, et le laisser supprimé ferait échouer le suivant pour une
  // raison qui n'a rien à voir avec ce qu'il vérifie.
  if (INITIAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = INITIAL_CRON_SECRET;
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────
// Idempotence — l'AC le plus coûteux s'il est faux
// ─────────────────────────────────────────────────────────────────────

describe("idempotence de la réconciliation", () => {
  it("deux réconciliations successives → aucun double décrément de stock, aucun double email", async () => {
    const fixture = await makePendingPayment({ quantity: 2, providerRef: `mock_ok_${newId()}` });
    const stockBefore = await readStock(fixture.variantId);

    const first = await runPaymentReconciliationJob({ now: new Date(Date.now() - 3_600_000) });
    expect(first.meta).toEqual({ checked: 1, succeeded: 1, failed: 0, stillPending: 0 });

    expect((await readOrder(fixture.orderId)).status).toBe("PAID");
    expect((await readPayment(fixture.paymentId)).status).toBe("SUCCEEDED");
    const stockAfterFirst = await readStock(fixture.variantId);
    expect(stockAfterFirst.quantity).toBe(stockBefore.quantity - 2);
    expect(stockAfterFirst.reserved).toBe(0);
    expect(await prismaTest.emailOutbox.count()).toBe(1);

    // ── Deuxième passage, par un AUTRE canal : on remet la ligne en attente,
    // exactement comme le ferait un webhook rejoué ou un opérateur qui relance
    // « Vérifier maintenant » sur une commande qu'il croit encore bloquée.
    await prismaTest.payment.update({
      where: { id: fixture.paymentId },
      data: { status: "PENDING", nextReconcileAt: new Date(Date.now() - 7_200_000) },
    });

    const second = await runPaymentReconciliationJob({ now: new Date(Date.now() - 600_000) });
    // La ligne a bien été RÉINTERROGÉE (sinon ce test ne prouverait rien)…
    expect(second.meta.checked).toBe(1);
    expect(second.results[0]!.idempotent).toBe(true);

    // …et rien n'a été compté deux fois.
    expect(await prismaTest.emailOutbox.count()).toBe(1);
    const stockAfterSecond = await readStock(fixture.variantId);
    expect(stockAfterSecond.quantity).toBe(stockBefore.quantity - 2);
    expect(stockAfterSecond.reserved).toBe(0);
    expect((await readOrder(fixture.orderId)).status).toBe("PAID");
    expect((await readPayment(fixture.paymentId)).status).toBe("SUCCEEDED");
    expect(await prismaTest.jobRun.count()).toBe(2);
  });

  it("« Vérifier maintenant » deux fois : le second appel ne réécrit rien", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    const stockBefore = await readStock(fixture.variantId);

    const first = await reconcilePaymentById(fixture.paymentId);
    expect(first!.verdict).toBe("succeeded");
    expect(first!.paymentStatus).toBe("SUCCEEDED");
    expect(await prismaTest.emailOutbox.count()).toBe(1);

    const second = await reconcilePaymentById(fixture.paymentId);
    // Le paiement n'est plus en attente : on ne réinterroge pas le fournisseur.
    expect(second!.verdict).toBe("not_pending");
    expect(second!.idempotent).toBe(true);

    expect(await prismaTest.emailOutbox.count()).toBe(1);
    const stockAfter = await readStock(fixture.variantId);
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 1);
    expect(stockAfter.reserved).toBe(0);
  });

  it("un identifiant de paiement inconnu ne lève pas : il renvoie null", async () => {
    expect(await reconcilePaymentById("cuid-inexistant")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Un paiement confirmé n'est jamais rétrogradé
// ─────────────────────────────────────────────────────────────────────

describe("un verdict tardif ne rétrograde jamais un paiement confirmé", () => {
  it("callback Mobile Money pendant la vérification → statut inchangé, rien de rétrogradé", async () => {
    const providerRef = `mm_MTN_${newId()}`;
    const fixture = await makePendingPayment({
      provider: "mobile_money",
      providerRef,
    });
    const stockBefore = await readStock(fixture.variantId);

    // Le fournisseur simulé est ici le théâtre d'une COURSE réelle : on est en
    // train de l'interroger (la sélection a lu la ligne comme PENDING) quand le
    // callback de l'opérateur confirme le paiement. Puis notre interrogation
    // rend un verdict « échec » — périmé. C'est exactement le scénario que l'AC
    // interdit de prendre au pied de la lettre.
    const racingProvider = stubProvider({
      name: "mobile_money",
      capture: async (ref: string) => {
        const callback = await mmCallback(
          callbackRequest({
            providerRef: ref,
            eventKey: `evt_course_${newId()}`,
            type: "payment.succeeded",
            status: "succeeded",
          }),
        );
        expect(callback.status).toBe(200);
        return { status: "failed" };
      },
    });

    const run = await runPaymentReconciliationJob({
      now: new Date(Date.now() - 3_600_000),
      providerFor: () => racingProvider,
    });

    expect(run.meta.checked).toBe(1);
    const result = run.results[0]!;
    // Le fournisseur a bien dit « échec » (le compteur le dit sans mentir)…
    expect(result.verdict).toBe("failed");
    expect(result.idempotent).toBe(true);
    // …mais la transition unique a refusé de rétrograder.
    expect(result.paymentStatus).toBe("SUCCEEDED");
    expect(result.orderStatus).toBe("PAID");
    expect(result.message).toContain("DÉJÀ confirmé");

    const payment = await readPayment(fixture.paymentId);
    expect(payment.status).toBe("SUCCEEDED");
    const order = await readOrder(fixture.orderId);
    expect(order.status).toBe("PAID");
    expect(order.cancelledAt).toBeNull();

    // Le stock reste décrémenté une seule fois — la réconciliation n'a rien
    // « remis en vente » derrière un paiement confirmé.
    const stock = await readStock(fixture.variantId);
    expect(stock.quantity).toBe(stockBefore.quantity - 1);
    expect(stock.reserved).toBe(0);
    expect(await prismaTest.emailOutbox.count()).toBe(1);
  });

  it("la transition unique refuse aussi un « pending » tardif sur un paiement confirmé", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    await reconcilePaymentById(fixture.paymentId); // confirme

    await prismaTest.payment.update({
      where: { id: fixture.paymentId },
      data: { status: "PENDING", nextReconcileAt: null },
    });

    const run = await runPaymentReconciliationJob({
      now: new Date(),
      providerFor: () =>
        stubProvider({ capture: async () => ({ status: "pending" }) }),
    });

    const result = run.results[0]!;
    expect(result.verdict).toBe("pending");
    expect(result.idempotent).toBe(true);
    expect((await readPayment(fixture.paymentId)).status).toBe("SUCCEEDED");
    expect((await readOrder(fixture.orderId)).status).toBe("PAID");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Backoff borné
// ─────────────────────────────────────────────────────────────────────

describe("backoff de la tâche", () => {
  it("progresse 2, 4, 8… et reste plafonné à 24 h (valeurs réelles de nextReconcileAt)", async () => {
    // Réf contenant « pending » : le fournisseur simulé ne se prononcera jamais,
    // ce qui force la ligne à rester dans le circuit de réconciliation.
    const fixture = await makePendingPayment({ providerRef: `mock_pending_${newId()}` });

    const expectedMinutes = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 1440, 1440];
    let now = new Date(Date.now() - 72 * 3_600_000);
    const observed: number[] = [];

    for (let index = 0; index < expectedMinutes.length; index += 1) {
      const run = await runPaymentReconciliationJob({ now });
      expect(run.meta).toEqual({ checked: 1, succeeded: 0, failed: 0, stillPending: 1 });

      const payment = await readPayment(fixture.paymentId);
      expect(payment.status).toBe("PENDING");
      expect(payment.reconcileAttempts).toBe(index + 1);
      expect(payment.lastCheckedAt?.getTime()).toBe(now.getTime());

      const next = payment.nextReconcileAt;
      expect(next).not.toBeNull();
      observed.push(Math.round((next!.getTime() - now.getTime()) / 60_000));

      // La ligne est DUE au tour suivant dès l'instant planifié (`<= now`).
      now = next!;
    }

    expect(observed).toEqual(expectedMinutes);
    // Un JobRun par exécution, ni plus ni moins.
    expect(await prismaTest.jobRun.count()).toBe(expectedMinutes.length);

    // Au plafond : la machine a fait ce qu'elle pouvait.
    const view = await listPendingPayments({ now });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]!.needsManualReview).toBe(true);
    expect(view.rows[0]!.reconcileAttempts).toBe(RECONCILE_MAX_ATTEMPTS + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Aucune annulation silencieuse (décision D6)
// ─────────────────────────────────────────────────────────────────────

describe("aucune décision automatique (D6)", () => {
  it("au bout des tentatives : le paiement reste PENDING, la commande n'est pas annulée, le stock reste réservé", async () => {
    const fixture = await makePendingPayment({
      quantity: 2,
      providerRef: `mock_pending_${newId()}`,
      reconcileAttempts: RECONCILE_MAX_ATTEMPTS,
      createdAt: new Date(Date.now() - 30 * 3_600_000),
    });
    const stockBefore = await readStock(fixture.variantId);
    const now = new Date();

    const run = await runPaymentReconciliationJob({ now });

    expect(run.status).toBe("SUCCEEDED");
    expect(run.meta).toEqual({ checked: 1, succeeded: 0, failed: 0, stillPending: 1 });

    const payment = await readPayment(fixture.paymentId);
    expect(payment.status).toBe("PENDING");
    expect(payment.reconcileAttempts).toBe(RECONCILE_MAX_ATTEMPTS + 1);
    // Au-delà du plafond, la cadence est quotidienne — pas d'arrêt, pas
    // d'annulation : un fournisseur peut se réveiller demain.
    expect(payment.nextReconcileAt!.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1_000);

    const order = await readOrder(fixture.orderId);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.cancelledAt).toBeNull();

    const stock = await readStock(fixture.variantId);
    expect(stock.quantity).toBe(stockBefore.quantity);
    expect(stock.reserved).toBe(2);

    // Aucune communication n'a été envoyée au client derrière son dos.
    expect(await prismaTest.emailOutbox.count()).toBe(0);

    // …et le paiement remonte en tête de /admin/paiements avec sa mention.
    const view = await listPendingPayments({ now });
    expect(view.total).toBe(1);
    expect(view.rows[0]!.needsManualReview).toBe(true);
    expect(view.rows[0]!.stale).toBe(true);
    expect(view.rows[0]!.ageHours).toBeGreaterThanOrEqual(29);
    expect(await countStalePendingPayments({ now })).toBe(1);
  });

  it("le compteur « PENDING > 24 h » ne compte pas un paiement récent", async () => {
    await makePendingPayment({ createdAt: new Date(Date.now() - 3_600_000) });
    await makePendingPayment({ createdAt: new Date(Date.now() - 26 * 3_600_000) });
    const now = new Date();
    expect(await countStalePendingPayments({ now })).toBe(1);
  });

  it("liste les paiements du plus ancien au plus récent, jamais un paiement soldé", async () => {
    const oldOne = await makePendingPayment({ createdAt: new Date(Date.now() - 48 * 3_600_000) });
    const recent = await makePendingPayment({ createdAt: new Date(Date.now() - 3_600_000) });
    await makePendingPayment({ paymentStatus: "SUCCEEDED" });

    const view = await listPendingPayments({ now: new Date() });

    expect(view.total).toBe(2);
    expect(view.rows.map((row) => row.orderNumber)).toEqual([
      oldOne.orderNumber,
      recent.orderNumber,
    ]);
    expect(view.rows[0]!.ageHours).toBeGreaterThan(view.rows[1]!.ageHours);
  });

  it("un paiement confirmé ne remonte plus dans la liste des blocages", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    expect((await listPendingPayments()).total).toBe(1);
    await reconcilePaymentById(fixture.paymentId);
    expect((await listPendingPayments()).total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Un JobRun par exécution, y compris en échec
// ─────────────────────────────────────────────────────────────────────

describe("traçabilité des exécutions (JobRun)", () => {
  it("écrit exactement un JobRun SUCCEEDED avec le meta complet", async () => {
    await makePendingPayment({ providerRef: `mock_ok_${newId()}` });

    const run = await runPaymentReconciliationJob({ now: new Date() });

    const jobRuns = await prismaTest.jobRun.findMany();
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0]!.name).toBe("reconcile-payments");
    expect(jobRuns[0]!.status).toBe("SUCCEEDED");
    expect(jobRuns[0]!.finishedAt).toBeTruthy();
    expect(jobRuns[0]!.error).toBeNull();
    expect(jobRuns[0]!.meta).toEqual({ checked: 1, succeeded: 1, failed: 0, stillPending: 0 });
    expect(run.jobRunId).toBe(jobRuns[0]!.id);
  });

  it("écrit un JobRun FAILED avec le message quand l'exécution lève une erreur", async () => {
    const run = await runPaymentReconciliationJob({
      now: new Date(),
      // La seule panne qu'aucune ligne ne peut absorber : l'accès à la base.
      selectDuePayments: async () => {
        throw new Error("base injoignable (simulation)");
      },
    });

    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("base injoignable");
    expect(run.meta).toEqual({ checked: 0, succeeded: 0, failed: 0, stillPending: 0 });

    const jobRuns = await prismaTest.jobRun.findMany();
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0]!.name).toBe("reconcile-payments");
    expect(jobRuns[0]!.status).toBe("FAILED");
    expect(jobRuns[0]!.finishedAt).toBeTruthy();
    expect(jobRuns[0]!.error).toContain("base injoignable");
    expect(jobRuns[0]!.meta).toEqual({ checked: 0, succeeded: 0, failed: 0, stillPending: 0 });
  });

  it("un fournisseur injoignable n'interrompt pas le lot et n'annule rien", async () => {
    const broken = await makePendingPayment({ providerRef: `mock_boom_${newId()}` });
    const healthy = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });

    const run = await runPaymentReconciliationJob({
      now: new Date(),
      providerFor: () =>
        stubProvider({
          capture: async (ref: string) => {
            if (ref.includes("boom")) throw new Error("fournisseur injoignable");
            return { status: "succeeded" };
          },
        }),
    });

    expect(run.status).toBe("SUCCEEDED");
    expect(run.meta).toEqual({ checked: 2, succeeded: 1, failed: 1, stillPending: 0 });
    expect(run.error).toContain("fournisseur injoignable");

    // Le paiement en panne reste en attente, avec un compteur incrémenté : il
    // sera repris avec un délai plus long, pas oublié.
    const brokenPayment = await readPayment(broken.paymentId);
    expect(brokenPayment.status).toBe("PENDING");
    expect(brokenPayment.reconcileAttempts).toBe(1);
    expect(brokenPayment.nextReconcileAt).not.toBeNull();
    expect((await readOrder(broken.orderId)).status).toBe("PENDING_PAYMENT");
    expect((await readStock(broken.variantId)).reserved).toBe(1);

    // Le voisin, lui, a bien été réconcilié.
    expect((await readPayment(healthy.paymentId)).status).toBe("SUCCEEDED");
    expect((await readOrder(healthy.orderId)).status).toBe("PAID");

    // Un JobRun unique, avec le résumé lisible par le marchand.
    expect(await prismaTest.jobRun.count()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Route de cron
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/cron/reconcile-payments", () => {
  const SECRET = "secret-cron-des-tests";

  it("renvoie 401 sans secret, et n'exécute rien", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    process.env.CRON_SECRET = SECRET;

    const res = await cronReconcile(cronRequest());
    expect(res.status).toBe(401);
    expect(await prismaTest.jobRun.count()).toBe(0);
    // La réservation du checkout est intacte et la commande n'a pas bougé.
    expect((await readStock(fixture.variantId)).reserved).toBe(1);
    expect((await readOrder(fixture.orderId)).status).toBe("PENDING_PAYMENT");
  });

  it("renvoie 401 avec un mauvais secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await cronReconcile(cronRequest("mauvais-secret"));
    expect(res.status).toBe(401);
    expect(await prismaTest.jobRun.count()).toBe(0);
  });

  it("renvoie 200 avec le bon secret et exécute la tâche (un seul JobRun)", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    process.env.CRON_SECRET = SECRET;

    const res = await cronReconcile(cronRequest(SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.meta).toEqual({ checked: 1, succeeded: 1, failed: 0, stillPending: 0 });
    expect(body.checked).toHaveLength(1);

    expect(await prismaTest.jobRun.count()).toBe(1);
    expect((await readPayment(fixture.paymentId)).status).toBe("SUCCEEDED");
  });

  it("accepte aussi le secret en Authorization: Bearer", async () => {
    process.env.CRON_SECRET = SECRET;
    const req = new NextRequest("http://localhost:3000/api/cron/reconcile-payments", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    const res = await cronReconcile(req);
    expect(res.status).toBe(200);
  });

  it("refuse en 503 quand CRON_SECRET n'est pas configuré (jamais un passage libre)", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronReconcile(cronRequest("n'importe-quoi"));
    expect(res.status).toBe(503);
    expect(await prismaTest.jobRun.count()).toBe(0);
  });

  it("une seconde exécution ne double rien (idempotence côté route)", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    const stockBefore = await readStock(fixture.variantId);
    process.env.CRON_SECRET = SECRET;

    expect((await cronReconcile(cronRequest(SECRET))).status).toBe(200);
    expect((await cronReconcile(cronRequest(SECRET))).status).toBe(200);

    const stockAfter = await readStock(fixture.variantId);
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 1);
    expect(await prismaTest.emailOutbox.count()).toBe(1);
    // Deux exécutions = deux lignes de trace, mais un seul encaissement.
    expect(await prismaTest.jobRun.count()).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Accès : STAFF lit, ADMIN décide
// ─────────────────────────────────────────────────────────────────────

describe("/admin/paiements et ses actions", () => {
  it("un STAFF lit la page (rendu réel) et ne dispose PAS de l'action d'encaissement", async () => {
    const fixture = await makePendingPayment({
      provider: "bank_transfer",
      providerRef: `bt_${newId()}`,
      reconcileAttempts: RECONCILE_MAX_ATTEMPTS,
      createdAt: new Date(Date.now() - 48 * 3_600_000),
    });
    const staff = await staffSession("STAFF");
    cookieJar.set(ADMIN_COOKIE, staff.token);

    const element = await AdminPaymentsPage();
    const tree = expandServerComponents(element, [DataTable]);
    const text = visibleText(tree);

    expect(text).toContain("Paiements en attente");
    expect(text).toMatch(/PENDING > 24 h\s*:\s*1/);
    expect(text).toContain(fixture.orderNumber);
    expect(text).toContain("Aïcha Ndiaye");
    // La mention exigée par D6 pour un paiement au bout des tentatives.
    expect(text).toContain("à traiter manuellement");

    const actions = findElements(tree, PaymentActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.props.canConfirmReceipt).toBe(false);
  });

  it("un ADMIN dispose de l'action d'encaissement sur la page", async () => {
    await makePendingPayment({
      provider: "bank_transfer",
      providerRef: `bt_${newId()}`,
      createdAt: new Date(Date.now() - 3_600_000),
    });
    const admin = await staffSession("ADMIN");
    cookieJar.set(ADMIN_COOKIE, admin.token);

    const element = await AdminPaymentsPage();
    const actions = findElements(expandServerComponents(element, [DataTable]), PaymentActions);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.props.canConfirmReceipt).toBe(true);
  });

  it("sans session, la page redirige vers la connexion", async () => {
    cookieJar.clear();
    await expectRedirect(AdminPaymentsPage(), "/admin/login");
  });

  it("un STAFF ne peut PAS déclencher « Marquer payé » (403) et rien n'est écrit", async () => {
    const fixture = await makePendingPayment({
      provider: "bank_transfer",
      providerRef: `bt_${newId()}`,
    });
    const staff = await staffSession("STAFF");

    const res = await markPaid(markPaidRequest(fixture.orderId, staff.token), {
      params: { id: fixture.orderId },
    });
    expect(res.status).toBe(403);

    expect((await readOrder(fixture.orderId)).status).toBe("PENDING_PAYMENT");
    expect((await readPayment(fixture.paymentId)).status).toBe("PENDING");
    expect(await prismaTest.auditLog.count()).toBe(0);
    expect(await prismaTest.emailOutbox.count()).toBe(0);
  });

  it("un ADMIN confirme le virement reçu : commande payée, stock décrémenté, ligne d'audit", async () => {
    const fixture = await makePendingPayment({
      provider: "bank_transfer",
      providerRef: `bt_${newId()}`,
    });
    const stockBefore = await readStock(fixture.variantId);
    const admin = await staffSession("ADMIN");

    const res = await markPaid(markPaidRequest(fixture.orderId, admin.token), {
      params: { id: fixture.orderId },
    });
    expect(res.status).toBe(200);

    expect((await readOrder(fixture.orderId)).status).toBe("PAID");
    expect((await readPayment(fixture.paymentId)).status).toBe("SUCCEEDED");
    const stockAfter = await readStock(fixture.variantId);
    expect(stockAfter.quantity).toBe(stockBefore.quantity - 1);
    expect(stockAfter.reserved).toBe(0);

    // L'audit répond à la seule question qui compte en cas de litige : qui ?
    const audit = await prismaTest.auditLog.findFirstOrThrow({
      where: { entityId: fixture.orderId, action: "order.mark_paid" },
    });
    expect(audit.userId).toBe(admin.userId);
    expect(audit.entity).toBe("Order");
    expect(audit.diff).toBeTruthy();
  });

  it("un STAFF peut relancer une vérification (c'est ce que la tâche fait seule)", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });
    const staff = await staffSession("STAFF");

    const res = await adminReconcile(reconcileRequest(fixture.paymentId, staff.token), {
      params: { id: fixture.paymentId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("succeeded");
    expect(body.message).toContain("Paiement confirmé");
    expect((await readPayment(fixture.paymentId)).status).toBe("SUCCEEDED");
  });

  it("la route de vérification refuse un appelant anonyme (401) et un paiement inconnu (404)", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_ok_${newId()}` });

    const anonymous = await adminReconcile(reconcileRequest(fixture.paymentId), {
      params: { id: fixture.paymentId },
    });
    expect(anonymous.status).toBe(401);

    const admin = await staffSession("ADMIN");
    const unknown = await adminReconcile(reconcileRequest("paiement-inconnu", admin.token), {
      params: { id: "paiement-inconnu" },
    });
    expect(unknown.status).toBe(404);
  });

  it("« Vérifier maintenant » dit en clair quand le fournisseur ne répond pas (échec)", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_fail_${newId()}` });
    const admin = await staffSession("ADMIN");

    const res = await adminReconcile(reconcileRequest(fixture.paymentId, admin.token), {
      params: { id: fixture.paymentId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("failed");
    expect(body.paymentStatus).toBe("FAILED");
    // Le message doit dire que RIEN n'a été annulé — c'est la promesse D6.
    expect(body.message).toContain("N'EST PAS annulée");

    const order = await readOrder(fixture.orderId);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect((await readStock(fixture.variantId)).reserved).toBe(1);
  });

  it("un paiement déjà soldé n'est pas réinterrogé par « Vérifier maintenant »", async () => {
    const fixture = await makePendingPayment({
      providerRef: `mock_ok_${newId()}`,
      paymentStatus: "REFUNDED",
    });
    const admin = await staffSession("ADMIN");

    const res = await adminReconcile(reconcileRequest(fixture.paymentId, admin.token), {
      params: { id: fixture.paymentId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("not_pending");
    // Le compteur n'a pas bougé : on n'a rien interrogé.
    expect((await readPayment(fixture.paymentId)).reconcileAttempts).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Message de verdict — lu par le marchand, pas par un dev
// ─────────────────────────────────────────────────────────────────────

describe("les messages affichés sont lisibles et non trompeurs", () => {
  it("un paiement non confirmé annonce la prochaine vérification", async () => {
    const fixture = await makePendingPayment({ providerRef: `mock_pending_${newId()}` });

    const result = await reconcilePaymentById(fixture.paymentId);

    expect(result!.verdict).toBe("pending");
    expect(result!.message).toContain("prochaine vérification automatique dans 2 min");
    expect(result!.nextReconcileAt).not.toBeNull();
  });
});
