/**
 * Interface `PaymentProvider` — point d'extension pour brancher Stripe,
 * Mobile Money, etc. sans toucher au code métier (checkout, webhooks).
 *
 * Pur TypeScript : aucune dépendance Next/Prisma.
 *
 * Cycle typique côté serveur :
 *   1. `createIntent(...)`     → crée l'intention, on persiste `providerRef`
 *      côté DB (Payment.providerRef) pour pouvoir appeler `capture`
 *      et `refund` ensuite.
 *   2. Côté front, le PSP confirme le paiement (Elements / redirect / USSD).
 *   3. Le PSP notifie NOTRE serveur (webhook) → `verifyWebhook(...)`.
 *      On lit `providerRef` du payload vérifié et on appelle `capture`
 *      si besoin pour récupérer le statut final côté PSP.
 *   4. `refund(...)` est appelé depuis l'admin (S3).
 */

export type Money = {
  amountCents: number;
  currency: string; // ISO-4217
};

export type CreateIntentInput = {
  orderId: string;
  amount: Money;
  customer: { email: string; name?: string };
  metadata: Record<string, string>;
  returnUrl: string;
};

export type CreateIntentResult = {
  providerRef: string;
  clientToken?: string;
  redirectUrl?: string;
  expiresAt?: Date;
};

export type CaptureResult = {
  status: "succeeded" | "pending" | "failed";
};

export type RefundResult = {
  refundRef: string;
  status: "succeeded" | "pending";
};

export type VerifyWebhookInput = {
  headers: Record<string, string>;
  rawBody: string;
};

export type VerifiedWebhook = {
  provider: string;
  eventKey: string;
  type: string;
  data: unknown;
};

export interface PaymentProvider {
  readonly name: string;

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  capture(providerRef: string): Promise<CaptureResult>;
  refund(providerRef: string, amount?: Money): Promise<RefundResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
}
