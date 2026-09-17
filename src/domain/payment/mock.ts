/**
 * Adaptateur Mock — `PaymentProvider` complet (S3).
 *
 * ─── POURQUOI CES SCÉNARIOS ──────────────────────────────────────────
 * Aucun compte PSP n'est disponible (ni Stripe, ni agrégateur Mobile Money).
 * Le mode mock doit donc couvrir TOUS les chemins de code qu'un vrai PSP
 * peut produire, sinon ces chemins restent morts et non testés :
 *
 *   - "success"  : cas nominal — capture immédiate réussie.
 *   - "failure"  : refus (fonds insuffisants, 3DS échoué, carte bloquée).
 *                  C'est ce qui doit déclencher la branche `Payment = FAILED`.
 *   - "pending"  : paiement asynchrone (Mobile Money, virement, SEPA). La
 *                  capture revient plusieurs fois "pending" avant de se
 *                  résoudre — c'est le cas qu'un vrai webhook viendra clore.
 *   - "delayed"  : le PSP a accepté l'intention mais met du temps à répondre.
 *                  L'intention est créée avec succès ; l'appelant doit
 *                  re-tenter `capture` (backoff) plutôt que d'échouer.
 *
 * Le scénario est piloté par `input.metadata.scenario` (convention sur la
 * metadata) et ENCODÉ DANS LA REF : `mock_<scenario>_<cuid2>`. C'est ce qui
 * rend `capture(ref)` déterministe sans état serveur — indispensable pour
 * tester l'idempotence et les transitions sans base ni PSP.
 *
 * ─── BRANCHER UN VRAI PSP PLUS TARD ──────────────────────────────────
 * 1. Créer `src/domain/payment/stripe.ts` (ou un adaptateur pour l'agrégateur
 *    Mobile Money retenu) qui implémente `PaymentProvider`.
 * 2. Lever les variables d'env correspondantes (STRIPE_SECRET_KEY, …).
 * 3. Passer `PAYMENT_PROVIDER` à la nouvelle valeur — `registry.ts` fait le
 *    reste : ni `src/server/checkout.ts` ni les routes API ne connaissent le
 *    provider concret.
 * 4. `verifyWebhook` du mock (voir plus bas) a EXACTEMENT la même forme que
 *    celle d'un vrai PSP : un header de signature + un body JSON avec un
 *    `eventKey` unique. La logique d'idempotence côté `WebhookEvent` peut donc
 *    être testée dès maintenant et restera identique après la bascule.
 */

import { createId } from "@paralleldrive/cuid2";
import type {
  CaptureResult,
  CreateIntentInput,
  CreateIntentResult,
  Money,
  PaymentProvider,
  RefundResult,
  VerifiedWebhook,
  VerifyWebhookInput,
} from "@/domain/payment/provider";

const THIRTY_MIN_MS = 30 * 60 * 1000;

/** Header de signature du PSP simulé (même rôle que `stripe-signature`). */
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

/** Scénarios simulables, pilotés par `metadata.scenario`. */
export type MockScenario = "success" | "failure" | "pending" | "delayed";

/** Shape du body accepté par `verifyWebhook` (identique à un vrai PSP). */
export type MockWebhookBody = {
  eventKey: string;
  type: string;
  data: unknown;
};

function readScenario(metadata: Record<string, string>): MockScenario {
  const raw = metadata.scenario ?? "success";
  if (raw === "success" || raw === "failure" || raw === "pending" || raw === "delayed") {
    return raw;
  }
  throw new Error(
    `MockPaymentProvider: scenario inconnu "${raw}" (attendu: success | failure | pending | delayed)`,
  );
}

/**
 * Encode le scénario dans la ref pour que `capture` soit déterministe :
 *   success → mock_<cuid2>
 *   failure → mock_fail_<cuid2>
 *   pending → mock_pending_<cuid2>
 *   delayed → mock_delayed_<cuid2>
 */
function buildProviderRef(scenario: MockScenario): string {
  const id = createId();
  switch (scenario) {
    case "failure":
      return `mock_fail_${id}`;
    case "pending":
      return `mock_pending_${id}`;
    case "delayed":
      return `mock_delayed_${id}`;
    case "success":
      return `mock_${id}`;
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const scenario = readScenario(input.metadata);
    return {
      providerRef: buildProviderRef(scenario),
      expiresAt: new Date(Date.now() + THIRTY_MIN_MS),
    };
  }

  /**
   * Statut final côté "PSP" simulé, déduit de la ref :
   *   contient "fail"    → failed
   *   contient "pending" → pending
   *   sinon              → succeeded
   */
  async capture(providerRef: string): Promise<CaptureResult> {
    if (!providerRef) {
      throw new Error("MockPaymentProvider.capture: providerRef vide");
    }
    if (providerRef.includes("fail")) return { status: "failed" };
    if (providerRef.includes("pending")) return { status: "pending" };
    return { status: "succeeded" };
  }

  /**
   * Remboursement simulé. `amount` est optionnel (remboursement partiel) :
   * ici il n'est pas comptabilisé, mais l'API reste celle d'un vrai PSP.
   */
  async refund(providerRef: string, amount?: Money): Promise<RefundResult> {
    if (!providerRef) {
      throw new Error("MockPaymentProvider.refund: providerRef vide");
    }
    if (amount && amount.amountCents <= 0) {
      throw new Error("MockPaymentProvider.refund: amountCents doit être > 0");
    }
    return { refundRef: `re_${createId()}`, status: "succeeded" };
  }

  /**
   * Vérification de webhook simulée — même contrat qu'un vrai PSP :
   *   - header `x-mock-signature` (optionnel en mode mock : aucun secret réel
   *     n'est partagé, mais le chemin de vérification existe pour que la
   *     bascule vers un vrai HMAC soit un simple remplacement) ;
   *   - body JSON `{ eventKey, type, data }`.
   * `eventKey` est OBLIGATOIRE : c'est la clé d'idempotence qui alimente
   * `WebhookEvent @@unique([provider, eventKey])`.
   */
  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new Error("MockPaymentProvider.verifyWebhook: body JSON invalide");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MockPaymentProvider.verifyWebhook: body attendu = objet JSON");
    }
    const body = parsed as Record<string, unknown>;
    const eventKey = body.eventKey;
    if (typeof eventKey !== "string" || eventKey.trim() === "") {
      throw new Error(
        "MockPaymentProvider.verifyWebhook: eventKey manquant (clé d'idempotence requise)",
      );
    }
    const type = body.type;
    if (typeof type !== "string" || type.trim() === "") {
      throw new Error("MockPaymentProvider.verifyWebhook: type manquant");
    }

    const signature = input.headers[MOCK_SIGNATURE_HEADER] ?? input.headers["X-Mock-Signature"];
    if (signature !== undefined && signature.trim() === "") {
      throw new Error(
        "MockPaymentProvider.verifyWebhook: header x-mock-signature présent mais vide",
      );
    }

    return {
      provider: this.name,
      eventKey,
      type,
      data: body.data ?? null,
    };
  }
}
