/**
 * Vérification de webhook « simulée » partagée par les adaptateurs sans PSP
 * réel (`mock`, `mobile_money`).
 *
 * Le contrat est VOLONTAIREMENT identique à celui d'un vrai PSP :
 *   - un header de signature (`x-mock-signature`, en prod : HMAC du body) ;
 *   - un body JSON `{ eventKey, type, data }` où `eventKey` est l'identifiant
 *     unique de l'événement — la clé d'idempotence qui alimente
 *     `WebhookEvent @@unique([provider, eventKey])`.
 *
 * Conséquence : la logique d'idempotence (route callback, table WebhookEvent)
 * peut être écrite ET testée dès maintenant ; brancher un vrai PSP ne change
 * que l'implémentation de `verifyWebhook`, pas l'appelant.
 */

import type { VerifiedWebhook, VerifyWebhookInput } from "@/domain/payment/provider";

/** Header de signature utilisé par les adaptateurs simulés. */
export const SIMULATED_SIGNATURE_HEADER = "x-mock-signature";

export function parseSimulatedWebhook(
  providerName: string,
  input: VerifyWebhookInput,
): VerifiedWebhook {
  const prefix = `${providerName}.verifyWebhook`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    throw new Error(`${prefix}: body JSON invalide`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${prefix}: body attendu = objet JSON`);
  }

  const body = parsed as Record<string, unknown>;
  const eventKey = body.eventKey;
  if (typeof eventKey !== "string" || eventKey.trim() === "") {
    throw new Error(`${prefix}: eventKey manquant (clé d'idempotence requise)`);
  }
  const type = body.type;
  if (typeof type !== "string" || type.trim() === "") {
    throw new Error(`${prefix}: type manquant`);
  }

  const signature =
    input.headers[SIMULATED_SIGNATURE_HEADER] ?? input.headers["X-Mock-Signature"];
  if (signature !== undefined && signature.trim() === "") {
    throw new Error(`${prefix}: header x-mock-signature présent mais vide`);
  }

  return {
    provider: providerName,
    eventKey,
    type,
    data: body.data ?? null,
  };
}
