import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { selectPaymentProvider } from "@/domain/payment/registry";
import {
  applyPaymentOutcome,
  claimWebhookEvent,
  findOrderIdByPaymentRef,
  markWebhookProcessed,
  releaseClaimedWebhook,
} from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * Body envoyé par l'agrégateur Mobile Money (simulé).
 * `eventKey` est la clé d'idempotence ; `status` est indicatif (le statut
 * faisant foi est celui relu via `capture`, comme en production).
 */
const bodySchema = z.object({
  providerRef: z.string().min(1),
  eventKey: z.string().min(1),
  type: z.string().min(1),
  status: z.enum(["succeeded", "pending", "failed"]).optional(),
});

/**
 * POST /api/payments/mobile-money/callback
 *
 * Reçoit la notification de l'opérateur Mobile Money (Orange / MTN) :
 *   1. `verifyWebhook` valide la signature (`x-mock-signature`) et l'`eventKey`.
 *   2. On retrouve la commande via `Payment.providerRef`.
 *   3. `claimWebhookEvent` rend l'appel IDEMPOTENT : un rejeu du même
 *      `eventKey` répond 200 sans rien ré-exécuter (ADR-005).
 *   4. `capture` relit le statut réel chez le PSP, puis
 *      `applyPaymentOutcome` fait la transition (Order + Payment + stock) —
 *      la même fonction que le checkout "mock" et la validation admin.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const provider = selectPaymentProvider("mobile_money");

  try {
    await provider.verifyWebhook({ headers, rawBody });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook invalide";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json(
      { error: "Body invalide : { providerRef, eventKey, type, status? } attendu" },
      { status: 400 },
    );
  }

  const orderId = await findOrderIdByPaymentRef(provider.name, body.providerRef);
  if (!orderId) {
    return NextResponse.json(
      { error: `Aucun paiement ${provider.name} pour providerRef=${body.providerRef}` },
      { status: 404 },
    );
  }

  const claim = await claimWebhookEvent({
    provider: provider.name,
    eventKey: body.eventKey,
    type: body.type,
    payload: body,
  });
  if (claim.duplicate) {
    return NextResponse.json({ received: true, duplicate: true, eventKey: body.eventKey });
  }

  try {
    // Statut faisant foi : interrogation du PSP (ici simulation déterministe).
    const cap = await provider.capture(body.providerRef);
    const result = await applyPaymentOutcome(orderId, body.providerRef, cap.status);
    await markWebhookProcessed(claim.id);

    return NextResponse.json({
      received: true,
      duplicate: false,
      eventKey: body.eventKey,
      orderId: result.orderId,
      orderStatus: result.orderStatus,
      paymentStatus: result.paymentStatus,
      idempotent: result.idempotent,
      ...(body.status && body.status !== cap.status
        ? { note: `status déclaré "${body.status}" ignoré — statut fourni par le PSP : "${cap.status}"` }
        : {}),
    });
  } catch (err) {
    // Traitement échoué → on libère l'eventKey pour qu'un rejeu du PSP puisse
    // retenter (sinon le paiement resterait bloqué en PENDING à jamais).
    await releaseClaimedWebhook(claim.id).catch(() => {});
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("[/api/payments/mobile-money/callback] échec du traitement", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
