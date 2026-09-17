import { NextResponse } from "next/server";

import { listAvailableProviders } from "@/domain/payment/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/providers — méthodes de paiement RÉELLEMENT utilisables
 * sur cette instance (consommé par le formulaire de checkout).
 *
 * Aucune donnée sensible : on n'expose ni clé, ni config bancaire — juste le
 * nom, le libellé et la disponibilité.
 */
export function GET(): NextResponse {
  return NextResponse.json({ providers: listAvailableProviders() });
}
