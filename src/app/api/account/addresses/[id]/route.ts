import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { addressBodySchema } from "@/lib/address-schema";
import { requireCustomerApi } from "@/lib/customer-auth";
import {
  CustomerAccountError,
  customerAccountErrorStatus,
  deleteCustomerAddress,
  setDefaultCustomerAddress,
  updateCustomerAddress,
} from "@/server/customer-account";

export const dynamic = "force-dynamic";

/**
 * Charge utile réduite au seul choix du défaut. `.strict()` est essentiel :
 * sans lui, un corps complet `{ line1, city, …, isDefault: true }` matcherait
 * aussi et serait traité comme un simple changement de préférence — l'adresse
 * ne serait alors jamais modifiée, sans erreur pour le signaler.
 */
const defaultOnlySchema = z.object({ isDefault: z.literal(true) }).strict();

/**
 * PATCH /api/account/addresses/[id]
 *
 * Deux usages : édition complète de l'adresse, ou simple choix de l'adresse par
 * défaut (`{ isDefault: true }`). `customerId` est TOUJOURS repris de la
 * session, jamais de l'URL : c'est ce qui empêche de modifier l'adresse d'un
 * autre client en changeant l'id.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const customer = await requireCustomerApi(req);
  if (!customer) {
    return NextResponse.json({ error: "Authentification client requise" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (defaultOnlySchema.safeParse(payload).success) {
    try {
      await setDefaultCustomerAddress(customer.id, params.id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof CustomerAccountError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: customerAccountErrorStatus(err) },
        );
      }
      throw err;
    }
  }

  const parsed = addressBodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Champs invalides" }, { status: 400 });
  }

  try {
    const address = await updateCustomerAddress(customer.id, params.id, parsed.data);
    return NextResponse.json({ address });
  } catch (err) {
    if (err instanceof CustomerAccountError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: customerAccountErrorStatus(err) },
      );
    }
    throw err;
  }
}

/** DELETE /api/account/addresses/[id] — retire une adresse non utilisée. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const customer = await requireCustomerApi(req);
  if (!customer) {
    return NextResponse.json({ error: "Authentification client requise" }, { status: 401 });
  }

  try {
    await deleteCustomerAddress(customer.id, params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof CustomerAccountError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: customerAccountErrorStatus(err) },
      );
    }
    throw err;
  }
}
