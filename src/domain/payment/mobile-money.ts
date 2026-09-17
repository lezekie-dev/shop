/**
 * Adaptateur Mobile Money SIMULÉ (Orange Money / MTN Mobile Money).
 *
 * ─── POURQUOI SIMULÉ ─────────────────────────────────────────────────
 * Aucun agrégateur Mobile Money n'est contracté : pas de clé API, pas de
 * compte marchand. La simulation reproduit néanmoins le PARCOURS RÉEL pour
 * que l'UX et la machine à états soient justes :
 *   1. le client saisit son opérateur et son numéro → `createIntent`
 *      crée une « demande de paiement » avec ref `mm_<OPERATOR>_<cuid2>` ;
 *   2. il est redirigé vers une page qui affiche l'instruction USSD à
 *      composer (c'est ce que fait un vrai push USSD / une page hébergée
 *      par l'opérateur) ;
 *   3. le paiement expire en 15 minutes — durée de vie réelle d'un push USSD ;
 *   4. l'opérateur notifie la boutique de façon ASYNCHRONE → route
 *      `POST /api/payments/mobile-money/callback` (header `x-mock-signature`
 *      + body `{ eventKey, type, data }`), idempotente via `WebhookEvent`.
 * Donc : `capture` reste "pending" après le checkout, et la commande ne
 * passe à PAID qu'à la réception du callback — comme en production.
 *
 * ─── QUEL AGRÉGATEUR RÉEL BRANCHER, ET COMMENT ───────────────────────
 * Cible : **NotchPay** (notchpay.co, Yaoundé) — agrégateur couvrant Orange
 * Money, MTN MoMo et Wave sur XAF/XOF, avec une API REST unique :
 * `POST https://api.notchpay.co/payments` (header `Authorization: <public_key>`,
 * body `{ amount, currency, reference, customer: { phone }, channel }`) →
 * renvoie `{ transaction: { reference }, payment_url }`. On mappe
 * `transaction.reference` sur `providerRef` et `payment_url` sur `redirectUrl`,
 * et on expose `POST /api/payments/mobile-money/callback` sur l'URL de webhook
 * déclarée dans le dashboard (vérification `x-notch-signature` = HMAC-SHA256
 * du body brut avec la clé secrète, exactement le même chemin que le mock
 * ci-dessous). Alternative équivalente : **Flutterwave** (`POST /v3/payments`,
 * webhook `verif-hash`) ou **PayDunya** (francophone, Orange/MTN). Dans les
 * trois cas, seul ce fichier change : `createIntent` appelle l'API, `capture`
 * lit le statut de la transaction, `verifyWebhook` calcule le HMAC réel.
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
import {
  parseSimulatedWebhook,
  SIMULATED_SIGNATURE_HEADER,
} from "@/domain/payment/simulated-webhook";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/** Base des pages d'instruction Mobile Money (cible du redirectUrl). */
export const MOBILE_MONEY_INSTRUCTIONS_PATH = "/paiement/mobile-money";

/** Header de signature accepté par le callback simulé. */
export const MOBILE_MONEY_SIGNATURE_HEADER = SIMULATED_SIGNATURE_HEADER;

export type MobileMoneyOperator = "ORANGE" | "MTN";

export type MobileMoneyOperatorInfo = {
  code: MobileMoneyOperator;
  label: string;
  /** Instruction USSD affichée au client (valeurs de démonstration). */
  ussd: string;
};

export const MOBILE_MONEY_OPERATORS: readonly MobileMoneyOperatorInfo[] = [
  { code: "ORANGE", label: "Orange Money", ussd: "#150*1*1#" },
  { code: "MTN", label: "MTN Mobile Money", ussd: "*126*1*1#" },
];

export function isMobileMoneyOperator(value: string): value is MobileMoneyOperator {
  return value === "ORANGE" || value === "MTN";
}

/** Normalise `metadata.operator` ("orange", "Orange" → "ORANGE"). */
export function normalizeOperator(raw: string): MobileMoneyOperator {
  const upper = raw.trim().toUpperCase();
  if (isMobileMoneyOperator(upper)) return upper;
  throw new Error(
    `MobileMoneyPaymentProvider: opérateur inconnu "${raw}" (attendu: ORANGE | MTN)`,
  );
}

export class MobileMoneyPaymentProvider implements PaymentProvider {
  readonly name = "mobile_money";

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const rawOperator = input.metadata.operator;
    if (!rawOperator) {
      throw new Error(
        "MobileMoneyPaymentProvider.createIntent: metadata.operator requis (ORANGE | MTN)",
      );
    }
    const operator = normalizeOperator(rawOperator);

    const phone = input.metadata.phone?.trim();
    if (!phone) {
      throw new Error(
        "MobileMoneyPaymentProvider.createIntent: metadata.phone requis (numéro Mobile Money)",
      );
    }

    const providerRef = `mm_${operator}_${createId()}`;
    return {
      providerRef,
      redirectUrl: `${MOBILE_MONEY_INSTRUCTIONS_PATH}/${providerRef}`,
      expiresAt: new Date(Date.now() + FIFTEEN_MIN_MS),
    };
  }

  /**
   * Statut de la demande de paiement, déduit de la ref (déterminisme requis
   * par les tests, sans état serveur) :
   *   contient "fail"    → failed
   *   contient "pending" → pending
   *   sinon              → succeeded
   * En production, cette méthode interroge l'API de l'agrégateur.
   */
  async capture(providerRef: string): Promise<CaptureResult> {
    if (!providerRef) {
      throw new Error("MobileMoneyPaymentProvider.capture: providerRef vide");
    }
    if (providerRef.includes("fail")) return { status: "failed" };
    if (providerRef.includes("pending")) return { status: "pending" };
    return { status: "succeeded" };
  }

  async refund(providerRef: string, amount?: Money): Promise<RefundResult> {
    if (!providerRef) {
      throw new Error("MobileMoneyPaymentProvider.refund: providerRef vide");
    }
    if (amount && amount.amountCents <= 0) {
      throw new Error("MobileMoneyPaymentProvider.refund: amountCents doit être > 0");
    }
    return { refundRef: `mmre_${createId()}`, status: "succeeded" };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook> {
    return parseSimulatedWebhook(this.name, input);
  }
}
