import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { CART_COOKIE_NAME, getOrCreateCart } from "@/server/cart";
import {
  CheckoutError,
  createOrderFromCart,
  markOrderPaid,
  type CheckoutInput,
} from "@/server/checkout";
import { selectPaymentProvider } from "@/domain/payment/registry";

export const dynamic = "force-dynamic";

const addressSchema = z.object({
  line1: z.string().min(1, "line1 requis").max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1, "city requis").max(120),
  postalCode: z.string().min(1, "postalCode requis").max(20),
  country: z.string().min(2, "country requis").max(2),
});

const bodySchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  phone: z.string().min(1).max(40).optional(),
  address: addressSchema,
  billingAddressSame: z.boolean().default(true),
  paymentMethod: z.enum(["mock"]),
});

/**
 * POST /api/checkout — checkout invité complet (mock payment).
 *
 * Flow :
 *   1. Valide le body (zod).
 *   2. Crée la commande (createOrderFromCart) — Customer/Address/Order/Payment.
 *   3. Appelle le PSP mock : createIntent puis capture.
 *   4. Sur capture "succeeded" → markOrderPaid (Order → PAID, Stock décrémenté).
 *   5. Renvoie { orderId, orderNumber } pour redirection vers /checkout/success.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Champs invalides",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  if (!cookieVal) {
    return NextResponse.json({ error: "Pas de panier actif" }, { status: 400 });
  }

  // Garantit l'existence d'un Cart ACTIVE (sinon le cart cookie pointe vers rien)
  const { cart } = await getOrCreateCart({ cartCookieValue: cookieVal });

  // Shipping flat (S2) — S3 branchera un calculateur par zone / poids
  const shippingCents = Number.parseInt(process.env.SHIPPING_FLAT_CENTS ?? "590", 10);

  const provider = selectPaymentProvider();

  const checkoutInput: CheckoutInput = {
    customer: {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
    },
    shippingAddress: data.address,
    ...(data.billingAddressSame
      ? {}
      : {
          billingAddress: data.address, // en S2 on n'a qu'une seule adresse ; S3 distinguera
        }),
    paymentMethod: "mock",
    shippingCents,
    currency: "EUR",
  };

  let orderResult: { orderId: string; orderNumber: string; totalCents: number; paymentRef: string };
  try {
    orderResult = await createOrderFromCart(cart.id, checkoutInput, {
      createPaymentIntent: async () => {
        const intent = await provider.createIntent({
          orderId: "pending", // sera connu après createOrder ; pas critique pour mock
          amount: {
            amountCents: shippingCents, // sera écrasé par totalCents réel côté DB
            currency: "EUR",
          },
          customer: { email: data.email, name: `${data.firstName} ${data.lastName}` },
          metadata: { cartId: cart.id },
          returnUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/checkout/success`,
        });
        return { providerRef: intent.providerRef, expiresAt: intent.expiresAt ?? null };
      },
    });
  } catch (err) {
    return mapCheckoutError(err);
  }

  // Capture (mock : toujours "succeeded")
  try {
    const cap = await provider.capture(orderResult.paymentRef);
    if (cap.status === "succeeded") {
      await markOrderPaid(orderResult.orderId);
    } else {
      // En S2 on n'a que mock, donc ce chemin ne s'exécute pas.
      return NextResponse.json(
        { error: `Paiement non confirmé (${cap.status})`, orderId: orderResult.orderId },
        { status: 402 },
      );
    }
  } catch (err) {
    console.error("[/api/checkout] capture/payment error", err);
    return NextResponse.json(
      { error: "Erreur lors de la confirmation du paiement", orderId: orderResult.orderId },
      { status: 500 },
    );
  }

  // Clear le cookie cart_id maintenant que le panier est CONVERTED
  const res = NextResponse.json({
    orderId: orderResult.orderId,
    orderNumber: orderResult.orderNumber,
    totalCents: orderResult.totalCents,
  });
  res.cookies.set(CART_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

function mapCheckoutError(err: unknown): NextResponse {
  if (err instanceof CheckoutError) {
    const status =
      err.code === "OUT_OF_STOCK"
        ? 409
        : err.code === "CART_NOT_FOUND"
          ? 404
          : err.code === "CART_EMPTY" || err.code === "CART_CONVERTED"
            ? 410
            : err.code === "PAYMENT_FAILED"
              ? 402
              : 400;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error("[/api/checkout] unexpected error", err);
  return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
}
