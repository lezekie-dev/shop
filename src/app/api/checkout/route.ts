import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { selectPaymentProvider } from "@/domain/payment/registry";
import { CART_COOKIE_NAME, getOrCreateCart } from "@/server/cart";
import {
  CheckoutError,
  createOrderFromCart,
  markOrderPaid,
  type CheckoutInput,
  type CheckoutPaymentMethod,
} from "@/server/checkout";
import { PaymentError, applyPaymentOutcome } from "@/server/payments";

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
  paymentMethod: z.enum(["mock", "mobile_money", "bank_transfer"]),
  /** Mobile Money uniquement — opérateur choisi par le client. */
  operator: z.enum(["ORANGE", "MTN"]).optional(),
  /**
   * Ouvre le pilotage des scénarios du provider mock (failure/pending/…)
   * sans code de test : indispensable pour démontrer les chemins d'échec
   * tant qu'aucun PSP réel n'est branché.
   */
  scenario: z.enum(["success", "failure", "pending", "delayed"]).optional(),
});

/**
 * POST /api/checkout — checkout invité, multi-méthodes de paiement.
 *
 * Flow commun :
 *   1. Valide le body (zod) + la cohérence méthode/opérateur.
 *   2. createOrderFromCart — Customer/Address/Order/Payment + réservation stock.
 *   3. Selon la méthode :
 *      - "mock"          : createIntent + capture immédiate. Succès → Order
 *                          PAID et stock décrémenté ; échec → 402 ; pending →
 *                          la commande reste PENDING_PAYMENT.
 *      - "mobile_money"  : createIntent → redirectUrl vers la page USSD.
 *                          La confirmation viendra du callback opérateur.
 *      - "bank_transfer" : createIntent → redirectUrl vers les instructions
 *                          IBAN. Confirmation manuelle par l'admin.
 *   4. Le cookie panier est effacé dans tous les cas (Cart = CONVERTED).
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
  const method: CheckoutPaymentMethod = data.paymentMethod;

  // Contrôles propres à chaque méthode, AVANT de créer la moindre commande.
  if (method === "mobile_money") {
    if (!data.operator) {
      return NextResponse.json(
        { error: "operator requis pour un paiement Mobile Money (ORANGE | MTN)" },
        { status: 400 },
      );
    }
    if (!data.phone) {
      return NextResponse.json(
        { error: "phone requis pour un paiement Mobile Money" },
        { status: 400 },
      );
    }
  }

  const cookieVal = req.cookies.get(CART_COOKIE_NAME)?.value;
  if (!cookieVal) {
    return NextResponse.json({ error: "Pas de panier actif" }, { status: 400 });
  }

  // Garantit l'existence d'un Cart ACTIVE (sinon le cart cookie pointe vers rien)
  const { cart } = await getOrCreateCart({ cartCookieValue: cookieVal });

  const shippingCents = Number.parseInt(process.env.SHIPPING_FLAT_CENTS ?? "590", 10);
  const currency = process.env.SHOP_CURRENCY ?? "EUR";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Le provider est imposé par la méthode choisie (indépendant de
  // PAYMENT_PROVIDER, qui ne sert que de défaut serveur).
  const provider = selectPaymentProvider(method);

  const providerMetadata: Record<string, string> = {
    paymentMethod: method,
    ...(data.operator ? { operator: data.operator } : {}),
    ...(data.phone ? { phone: data.phone } : {}),
    ...(method === "mock" ? { scenario: data.scenario ?? "success" } : {}),
  };

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
          billingAddress: data.address,
        }),
    paymentMethod: method,
    shippingCents,
    currency,
  };

  let orderResult: Awaited<ReturnType<typeof createOrderFromCart>>;
  try {
    orderResult = await createOrderFromCart(cart.id, checkoutInput, {
      createPaymentIntent: async (ctx) => {
        const intent = await provider.createIntent({
          orderId: ctx.orderId,
          amount: { amountCents: ctx.amountCents, currency: ctx.currency },
          customer: ctx.customer,
          metadata: { ...ctx.metadata, ...providerMetadata },
          returnUrl: `${siteUrl}/checkout/success`,
        });
        return {
          providerRef: intent.providerRef,
          expiresAt: intent.expiresAt ?? null,
          ...(intent.redirectUrl !== undefined ? { redirectUrl: intent.redirectUrl } : {}),
        };
      },
    });
  } catch (err) {
    return mapCheckoutError(err);
  }

  // ── Méthodes asynchrones : on rend la main au client avec son redirectUrl ──
  if (method === "mobile_money" || method === "bank_transfer") {
    return withClearedCartCookie(
      NextResponse.json({
        orderId: orderResult.orderId,
        orderNumber: orderResult.orderNumber,
        totalCents: orderResult.totalCents,
        status: "PENDING_PAYMENT",
        paymentMethod: method,
        paymentRef: orderResult.paymentRef,
        redirectUrl: orderResult.redirectUrl ?? null,
      }),
    );
  }

  // ── Méthode "mock" : capture immédiate dans la requête ──
  try {
    const cap = await provider.capture(orderResult.paymentRef);
    if (cap.status === "succeeded") {
      await markOrderPaid(orderResult.orderId);
    } else {
      await applyPaymentOutcome(orderResult.orderId, orderResult.paymentRef, cap.status);
      if (cap.status === "failed") {
        return withClearedCartCookie(
          NextResponse.json(
            {
              error: "Paiement refusé par le PSP",
              code: "PAYMENT_FAILED",
              orderId: orderResult.orderId,
              orderNumber: orderResult.orderNumber,
              status: "PENDING_PAYMENT",
            },
            { status: 402 },
          ),
        );
      }
    }

    return withClearedCartCookie(
      NextResponse.json({
        orderId: orderResult.orderId,
        orderNumber: orderResult.orderNumber,
        totalCents: orderResult.totalCents,
        status: cap.status === "succeeded" ? "PAID" : "PENDING_PAYMENT",
        paymentMethod: method,
        paymentRef: orderResult.paymentRef,
        redirectUrl: null,
      }),
    );
  } catch (err) {
    console.error("[/api/checkout] capture/payment error", err);
    return NextResponse.json(
      { error: "Erreur lors de la confirmation du paiement", orderId: orderResult.orderId },
      { status: 500 },
    );
  }
}

/** Le panier est CONVERTED dès que la commande existe : on efface le cookie. */
function withClearedCartCookie(res: NextResponse): NextResponse {
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
  if (err instanceof PaymentError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
  // Un provider peut refuser la création d'intention (opérateur inconnu,
  // numéro Mobile Money manquant, config PSP absente) : erreur d'entrée.
  if (err instanceof Error && !(err instanceof TypeError)) {
    console.error("[/api/checkout] provider error", err);
    return NextResponse.json({ error: err.message, code: "PAYMENT_PROVIDER_ERROR" }, { status: 400 });
  }
  console.error("[/api/checkout] unexpected error", err);
  return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
}
