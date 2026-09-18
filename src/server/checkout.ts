/**
 * Server layer — orchestration du checkout (multi-méthodes de paiement).
 *
 * Deux fonctions principales :
 *  - createOrderFromCart : crée Customer + Address + Order + OrderItem +
 *    Payment dans une seule transaction. Décrémente Stock.reserved
 *    (pas Stock.quantity — c'est ADR-004). Marque Cart CONVERTED.
 *  - markOrderPaid       : applique le verdict "succeeded" à une commande.
 *    Délègue à `applyPaymentOutcome` (src/server/payments.ts) — la MÊME
 *    implémentation que le callback Mobile Money et la validation du virement.
 *
 * Méthodes supportées (voir `listAvailableProviders`) :
 *  - "mock"          : capture immédiate → Order PAID dans la requête.
 *  - "mobile_money"  : intent + redirectUrl USSD → Order PENDING_PAYMENT,
 *                      confirmée par le callback de l'opérateur.
 *  - "bank_transfer" : intent + redirectUrl instructions IBAN → Order
 *                      PENDING_PAYMENT, confirmée par l'admin (mark-paid).
 *
 * Invariants respectés :
 *  - Toutes les écritures sont transactionnelles
 *    (`withSerializableRetry`, isolation `Serializable` — CONVENTIONS §12).
 *  - Le total est TOUJOURS recalculé serveur (jamais trusting client), remise
 *    comprise : le client propose un CODE, la remise est calculée ici.
 *  - Les prix et noms sont snapshotés dans OrderItem au moment de la création.
 */

import type { Prisma } from "@prisma/client";

import { withSerializableRetry } from "@/lib/serializable-tx";
import { generateOrderNumber } from "@/domain/order";
import { generateOrderAccessToken } from "@/lib/order-token";
import { applyPaymentOutcome } from "@/server/payments";
import { evaluatePromoCode, recordPromoRedemption } from "@/server/promo";

/** Méthodes de paiement acceptées par le checkout. */
export type CheckoutPaymentMethod = "mock" | "mobile_money" | "bank_transfer";

export const CHECKOUT_PAYMENT_METHODS: readonly CheckoutPaymentMethod[] = [
  "mock",
  "mobile_money",
  "bank_transfer",
];

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CART_NOT_FOUND"
      | "CART_EMPTY"
      | "CART_CONVERTED"
      | "OUT_OF_STOCK"
      | "VARIANT_NOT_FOUND"
      | "VARIANT_INACTIVE"
      | "CUSTOMER_INVALID"
      | "ADDRESS_INVALID"
      | "PAYMENT_FAILED"
      | "PAYMENT_PROVIDER_INVALID",
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Types d'entrée
// ─────────────────────────────────────────────────────────────────────

export type CustomerInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
};

export type AddressInput = {
  line1: string;
  line2?: string | undefined;
  city: string;
  postalCode: string;
  country: string;
};

export type CheckoutInput = {
  customer: CustomerInput;
  /** Adresse de livraison (toujours présente) */
  shippingAddress: AddressInput;
  /** Adresse de facturation (si différente) */
  billingAddress?: AddressInput | undefined;
  /** Méthode de paiement — voir CHECKOUT_PAYMENT_METHODS */
  paymentMethod: CheckoutPaymentMethod;
  /** Forfait livraison en centimes (par défaut lu depuis env) */
  shippingCents: number;
  /** Devise (par défaut "EUR") */
  currency: string;
};

export type CreateOrderResult = {
  orderId: string;
  orderNumber: string;
  /**
   * Jeton d'accès à la commande. C'est CE secret qu'on transmet au client pour
   * qu'il consulte sa commande — jamais `orderId`, qui reste un identifiant
   * interne de back-office.
   */
  accessToken: string;
  /** Sous-total des articles AVANT remise (recopié du Cart, jamais du client). */
  subtotalCents: number;
  /** Remise réellement appliquée, bornée au sous-total. */
  discountCents: number;
  totalCents: number;
  currency: string;
  /**
   * Code promo effectivement consommé (forme normalisée), `null` si aucun.
   * C'est ce que la confirmation affiche à côté de la ligne de remise : le
   * client doit pouvoir vérifier que c'est bien SON code qui a été appliqué.
   */
  promoCode: string | null;
  /**
   * Renseigné quand un code était saisi sur le panier mais ne s'applique plus
   * au moment de la commande (expiré entre-temps, plafond atteint par un autre
   * client…). La commande passe alors SANS remise : le PO refuse qu'une
   * expiration se transforme en erreur bloquante (AC E2), mais le client a le
   * droit de savoir pourquoi le total n'est pas celui qu'il a vu.
   */
  promoRefusal: { reason: string; message: string } | null;
  paymentRef: string;
  paymentProvider: string;
  /** Renseigné par les méthodes asynchrones (Mobile Money, virement). */
  redirectUrl?: string | undefined;
};

/**
 * Contexte transmis à `createPaymentIntent` — la route checkout le traduit en
 * `CreateIntentInput` pour le provider sélectionné.
 */
export type PaymentIntentContext = {
  orderId: string;
  amountCents: number;
  currency: string;
  customer: { email: string; name?: string | undefined };
  metadata: Record<string, string>;
};

export type PaymentIntentOutcome = {
  providerRef: string;
  expiresAt: Date | null;
  redirectUrl?: string | undefined;
};

// ─────────────────────────────────────────────────────────────────────
// Compteur de séquence pour generateOrderNumber
// ─────────────────────────────────────────────────────────────────────

/**
 * Lit un numéro de séquence mono-process pour `generateOrderNumber`.
 * En MVP / faible volumétrie : on compte les Order déjà créés cette année
 * et on ajoute 1. Pour passer à 1000+ commandes/jour, basculer sur une
 * table dédiée `OrderSequence` avec verrou advisory (S3+).
 */
async function nextOrderSeq(tx: Prisma.TransactionClient, year: number): Promise<number> {
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const startOfNextYear = new Date(Date.UTC(year + 1, 0, 1));
  const count = await tx.order.count({
    where: { placedAt: { gte: startOfYear, lt: startOfNextYear } },
  });
  return count + 1;
}

// ─────────────────────────────────────────────────────────────────────
// createOrderFromCart
// ─────────────────────────────────────────────────────────────────────

/**
 * Crée la commande à partir d'un Cart ACTIVE et des infos client/adresse.
 * - Le Cart passe en CONVERTED dans la même transaction.
 * - Le Payment est créé en PENDING avec providerRef issu du PSP.
 * - Le stock est réservé (Stock.reserved += quantity).
 *
 * Renvoie les infos pour que le caller puisse appeler ensuite
 * `capture` puis `markOrderPaid`.
 */
export async function createOrderFromCart(
  cartId: string,
  input: CheckoutInput,
  params: {
    createPaymentIntent: (ctx: PaymentIntentContext) => Promise<PaymentIntentOutcome>;
  },
): Promise<CreateOrderResult> {
  if (!CHECKOUT_PAYMENT_METHODS.includes(input.paymentMethod)) {
    throw new CheckoutError(
      `Méthode de paiement non supportée: ${input.paymentMethod}`,
      "PAYMENT_PROVIDER_INVALID",
    );
  }

  const year = new Date().getFullYear();

  // TRANSACTION `Serializable` + RETRY BORNÉ (CONVENTIONS §12).
  // POURQUOI CE NIVEAU D'ISOLATION ICI : depuis le chantier E, la transaction
  // lit un compteur d'usages et écrit la ligne qui l'incrémente. En Read
  // Committed, deux checkouts simultanés sur un code `maxRedemptions = 1`
  // lisent tous les deux « 0 usage » et accordent chacun leur remise : la
  // fuite de marge est invisible, elle ne casse aucun test séquentiel. Le
  // retry rejoue la transaction perdante sur des données à jour.
  return withSerializableRetry(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: { variant: { include: { product: true, stock: true } } },
        },
      },
    });

    if (!cart) {
      throw new CheckoutError(`Cart introuvable: ${cartId}`, "CART_NOT_FOUND");
    }
    if (cart.status !== "ACTIVE") {
      throw new CheckoutError(`Cart ${cartId} n'est pas ACTIVE`, "CART_CONVERTED");
    }
    if (cart.items.length === 0) {
      throw new CheckoutError(`Cart ${cartId} est vide`, "CART_EMPTY");
    }

    // 1) Vérifier disponibilité réelle (quantity - reserved) pour chaque ligne.
    for (const item of cart.items) {
      const v = item.variant;
      if (!v.active || !v.product.active) {
        throw new CheckoutError(
          `Variant ${v.id} inactif ou produit inactif`,
          "VARIANT_INACTIVE",
        );
      }
      const stockQty = v.stock?.quantity ?? 0;
      const stockReserved = v.stock?.reserved ?? 0;
      const available = stockQty - stockReserved;
      if (item.quantity > available) {
        throw new CheckoutError(
          `Stock insuffisant pour ${v.sku}: demandé ${item.quantity}, dispo ${available}`,
          "OUT_OF_STOCK",
        );
      }
    }

    // 2) Customer (par email — un email = un client fidèle à la commande)
    const customer = await tx.customer.upsert({
      where: { email: input.customer.email.toLowerCase() },
      update: {
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        ...(input.customer.phone !== undefined ? { phone: input.customer.phone } : {}),
      },
      create: {
        email: input.customer.email.toLowerCase(),
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        ...(input.customer.phone !== undefined ? { phone: input.customer.phone } : {}),
      },
    });

    // 3) Addresses (shipping + billing si différente)
    const shippingAddr = await tx.address.create({
      data: {
        customerId: customer.id,
        line1: input.shippingAddress.line1,
        ...(input.shippingAddress.line2 !== undefined ? { line2: input.shippingAddress.line2 } : {}),
        city: input.shippingAddress.city,
        postalCode: input.shippingAddress.postalCode,
        country: input.shippingAddress.country,
      },
    });
    const billingAddr = input.billingAddress
      ? await tx.address.create({
          data: {
            customerId: customer.id,
            line1: input.billingAddress.line1,
            ...(input.billingAddress.line2 !== undefined ? { line2: input.billingAddress.line2 } : {}),
            city: input.billingAddress.city,
            postalCode: input.billingAddress.postalCode,
            country: input.billingAddress.country,
          },
        })
      : shippingAddr;

    // 4) Totaux serveur (on ne fait JAMAIS confiance au client)
    const subtotalCents = cart.items.reduce(
      (acc, i) => acc + i.quantity * i.unitPriceCents,
      0,
    );
    const shippingCents = input.shippingCents;
    const currency = input.currency || cart.currency || "EUR";

    // 4 bis) CODE PROMO — décision prise ICI, dans la transaction.
    //
    // Le SEUL élément venu du client est `Cart.promoCode`, une chaîne. Aucun
    // montant n'entre dans cette fonction : un body de checkout portant
    // `discountCents: 99999` n'a tout simplement pas de champ où atterrir
    // (le schéma de la route ne le connaît pas, et cette fonction ne le lit
    // jamais). C'est le test de sécurité central de ce chantier : le client
    // propose un CODE, le serveur calcule le MONTANT.
    //
    // Les compteurs de plafond sont relus DANS la transaction, pas avant : une
    // validation faite « juste avant » serait périmée au moment de l'écriture.
    const now = new Date();
    const promo = cart.promoCode
      ? await evaluatePromoCode({
          rawCode: cart.promoCode,
          subtotalCents,
          // `Customer` vient d'être résolu (upsert par email) : c'est le seul
          // moment où un plafond PAR CLIENT est évaluable pour un visiteur.
          customerId: customer.id,
          now,
          db: tx,
        })
      : null;

    // Remise bornée au sous-total : le total ne peut jamais devenir négatif.
    const discountCents = promo?.evaluation.ok ? promo.evaluation.discountCents : 0;
    const promoRefusal =
      promo && !promo.evaluation.ok
        ? { reason: promo.evaluation.reason, message: promo.evaluation.message }
        : null;
    // La livraison n'est jamais remisée (périmètre du PO) : elle s'ajoute nue.
    const totalCents = subtotalCents - discountCents + shippingCents;

    // Nom affichable du client (passé au PSP), robuste aux champs null.
    const customerName = [customer.firstName, customer.lastName]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .trim();

    // 5) Numéro de commande lisible
    const seq = await nextOrderSeq(tx, year);
    const orderNumber = generateOrderNumber(seq, year);

    // 6) Order + OrderItems + décrément Stock.reserved + marque Cart CONVERTED
    const order = await tx.order.create({
      data: {
        number: orderNumber,
        accessToken: generateOrderAccessToken(),
        customerId: customer.id,
        addressId: shippingAddr.id, // adresse de livraison = référence canonique
        status: "PENDING_PAYMENT",
        subtotalCents,
        // La remise est FIGÉE sur la commande : c'est ce montant qui fait foi
        // pour le remboursement, la comptabilité et le KPI K6, même si le code
        // change ou est supprimé ensuite.
        discountCents,
        shippingCents,
        totalCents,
        currency,
        paymentProvider: input.paymentMethod,
        paymentRef: null, // mis après createPaymentIntent ci-dessous
        items: {
          create: cart.items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            productNameSnapshot: i.variant.product.name,
            variantNameSnapshot: i.variant.name,
          })),
        },
      },
    });

    for (const item of cart.items) {
      const current = await tx.stock.findUnique({ where: { variantId: item.variantId } });
      const newReserved = (current?.reserved ?? 0) + item.quantity;
      await tx.stock.upsert({
        where: { variantId: item.variantId },
        update: { reserved: newReserved },
        create: { variantId: item.variantId, quantity: 0, reserved: newReserved },
      });
    }

    // Note : on stocke l'adresse billing uniquement si elle est distincte
    // (sinon Order.addressId pointe déjà sur shipping). Pour S2, on garde
    // la même adresse physique ; le distinguo "billing same as shipping"
    // est porté par OrderItem/customer dans une version ultérieure si besoin.
    void billingAddr;

    // Consommation de l'usage du code — DANS la même transaction que la
    // commande. `PromoRedemption.orderId` est unique : un rejeu du checkout ne
    // peut donc pas débiter un second usage, même en cas de double soumission.
    if (promo && promo.evaluation.ok && promo.rule) {
      await recordPromoRedemption(tx, {
        promoCodeId: promo.rule.id,
        orderId: order.id,
        customerId: customer.id,
        amountCents: discountCents,
      });
    }

    await tx.cart.update({
      where: { id: cartId },
      data: {
        status: "CONVERTED",
        updatedAt: new Date(),
        discountCents,
        // Un code qui n'a pas pu s'appliquer est RETIRÉ du panier : le laisser
        // en base ferait réapparaître une remise fantôme sur un panier converti
        // et brouillerait la lecture d'un éventuel litige.
        ...(promoRefusal ? { promoCode: null, discountCents: 0 } : {}),
      },
    });

    // 7) Payment intent chez le PSP — providerRef sert d'id côté PSP.
    //    Le provider est injecté par l'appelant (registry) : ce module ne
    //    connaît aucun PSP concret (ADR-002).
    const intent = await params.createPaymentIntent({
      orderId: order.id,
      amountCents: totalCents,
      currency,
      customer: {
        email: customer.email,
        ...(customerName ? { name: customerName } : {}),
      },
      metadata: { cartId, orderNumber },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { paymentRef: intent.providerRef },
    });

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: input.paymentMethod,
        providerRef: intent.providerRef,
        amountCents: totalCents,
        currency,
        status: "PENDING",
      },
    });

    return {
      orderId: order.id,
      orderNumber,
      accessToken: order.accessToken,
      subtotalCents,
      discountCents,
      totalCents,
      currency,
      promoCode: promo?.evaluation.ok ? promo.evaluation.code : null,
      promoRefusal,
      paymentRef: intent.providerRef,
      paymentProvider: input.paymentMethod,
      ...(intent.redirectUrl !== undefined ? { redirectUrl: intent.redirectUrl } : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// markOrderPaid
// ─────────────────────────────────────────────────────────────────────

/**
 * Applique le verdict "succeeded" à une commande (capture immédiate d'un
 * paiement synchrone, callback PSP, ou validation manuelle par l'admin).
 *
 * ⚠ Implémentation UNIQUE dans `src/server/payments.ts` : ce wrapper existe
 * pour garder une API lisible côté checkout.
 */
export async function markOrderPaid(orderId: string): Promise<{ orderId: string }> {
  await applyPaymentOutcome(orderId, null, "succeeded");
  return { orderId };
}
