import { NextResponse, type NextRequest } from "next/server";

import { addressBodySchema } from "@/lib/address-schema";
import { requireCustomerApi } from "@/lib/customer-auth";
import {
  CustomerAccountError,
  createCustomerAddress,
  customerAccountErrorStatus,
  listCustomerAddresses,
} from "@/server/customer-account";

export const dynamic = "force-dynamic";

/** GET /api/account/addresses — carnet d'adresses du client connecté. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const customer = await requireCustomerApi(req);
  if (!customer) {
    return NextResponse.json({ error: "Authentification client requise" }, { status: 401 });
  }

  const addresses = await listCustomerAddresses(customer.id);
  return NextResponse.json({ addresses });
}

/** POST /api/account/addresses — ajoute une adresse au carnet. */
export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const parsed = addressBodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const address = await createCustomerAddress(customer.id, parsed.data);
    return NextResponse.json({ address }, { status: 201 });
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
