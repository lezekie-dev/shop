/**
 * Emails transactionnels — ZÉRO SMTP requis.
 *
 * ─── POURQUOI UNE OUTBOX EN BASE ─────────────────────────────────────
 * Aucun compte d'envoi n'est disponible (pas de SMTP, pas de Resend). Plutôt
 * que de simuler un envoi en le loguant (invisible, non testable), chaque
 * email est PERSISTÉ dans `EmailOutbox` : le message existe réellement, il est
 * lisible en base, testable en intégration, et rejouable.
 *
 * Le module est bâti autour de l'interface `EmailSender` (deep module) :
 *   - `OutboxEmailSender` (ACTIF)  : écrit la ligne, aucun compte requis ;
 *   - Resend / SMTP (à brancher)   : écrivent la même ligne puis l'envoient.
 * `selectEmailSender()` choisit via `EMAIL_PROVIDER` (défaut "outbox").
 * Brancher un vrai transport = une classe de plus, aucun appelant modifié.
 *
 * Les templates sont en français et contiennent ce qui compte pour le client :
 * numéro de commande, lignes, totaux, adresse, mode de paiement (confirmation),
 * transporteur + numéro de suivi (expédition).
 */

import { prisma } from "@/lib/db";

export type EmailTemplate = "order_confirmation" | "order_shipped";

export type EmailMessage = {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | undefined;
  template: EmailTemplate;
  orderId?: string | undefined;
};

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** Message d'erreur explicite pour un transport non configuré. */
export function emailProviderNotConfigured(provider: string): string {
  if (provider === "resend") {
    return (
      'EmailSender "resend" non configuré : définir RESEND_API_KEY et EMAIL_FROM, ' +
      "puis implémenter ResendEmailSender dans src/server/email.ts. " +
      'EMAIL_PROVIDER=outbox fonctionne sans aucun compte tiers.'
    );
  }
  if (provider === "smtp") {
    return (
      'EmailSender "smtp" non configuré : définir SMTP_URL (ex. smtp://user:pass@host:587) ' +
      "et EMAIL_FROM, puis implémenter SmtpEmailSender dans src/server/email.ts. " +
      'EMAIL_PROVIDER=outbox fonctionne sans aucun compte tiers.'
    );
  }
  return `EMAIL_PROVIDER inconnu : "${provider}" (attendu: outbox | resend | smtp)`;
}

/** Écrit l'email dans la table `EmailOutbox` — l'implémentation ACTIVE. */
export class OutboxEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    await prisma.emailOutbox.create({
      data: {
        to: msg.to,
        subject: msg.subject,
        bodyText: msg.bodyText,
        bodyHtml: msg.bodyHtml ?? null,
        template: msg.template,
        orderId: msg.orderId ?? null,
        provider: "outbox",
      },
    });
  }
}

export function selectEmailSender(provider?: string): EmailSender {
  const which = provider ?? process.env.EMAIL_PROVIDER ?? "outbox";
  if (which === "outbox") return new OutboxEmailSender();
  throw new Error(emailProviderNotConfigured(which));
}

// ─────────────────────────────────────────────────────────────────────
// Rendu des templates
// ─────────────────────────────────────────────────────────────────────

const SHOP_NAME = process.env.SHOP_NAME ?? "Shop Démo";

/** Formate un montant en minor units selon la devise (EUR → 2 décimales, XAF → 0). */
export function formatAmount(minorUnits: number, currency: string): string {
  const fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(minorUnits / 10 ** digits);
}

export type OrderEmailItem = {
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceCents: number;
};

export type OrderEmailData = {
  id: string;
  number: string;
  placedAt: Date;
  currency: string;
  subtotalCents: number;
  /** Remise du code promo, 0 si aucun code (chantier E). */
  discountCents: number;
  /** Code promo appliqué, `null` si aucun — affiché à côté de la remise. */
  promoCode: string | null;
  shippingCents: number;
  totalCents: number;
  paymentProvider: string;
  customerEmail: string;
  customerName: string;
  address: { line1: string; line2?: string | null; city: string; postalCode: string; country: string };
  items: OrderEmailItem[];
};

/** Charge tout ce dont les templates ont besoin, en une requête. */
export async function loadOrderEmailData(orderId: string): Promise<OrderEmailData> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      address: true,
      customer: { select: { email: true, firstName: true, lastName: true } },
      redemption: { include: { promoCode: { select: { code: true } } } },
    },
  });
  if (!order) {
    throw new Error(`loadOrderEmailData: commande introuvable ${orderId}`);
  }

  const name = [order.customer.firstName, order.customer.lastName]
    .filter((p): p is string => Boolean(p))
    .join(" ")
    .trim();

  return {
    id: order.id,
    number: order.number,
    placedAt: order.placedAt,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    promoCode: order.redemption?.promoCode.code ?? null,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    paymentProvider: order.paymentProvider,
    customerEmail: order.customer.email,
    customerName: name || order.customer.email,
    address: {
      line1: order.address.line1,
      line2: order.address.line2,
      city: order.address.city,
      postalCode: order.address.postalCode,
      country: order.address.country,
    },
    items: order.items.map((i) => ({
      productName: i.productNameSnapshot,
      variantName: i.variantNameSnapshot,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
    })),
  };
}

const PAYMENT_LABELS: Record<string, string> = {
  mock: "Paiement simulé (test)",
  mobile_money: "Mobile Money",
  bank_transfer: "Virement bancaire",
  stripe: "Carte bancaire",
};

function paymentLabel(provider: string): string {
  return PAYMENT_LABELS[provider] ?? provider;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(date);
}

function addressBlock(data: OrderEmailData): string {
  return [
    data.address.line1,
    data.address.line2 ?? null,
    `${data.address.postalCode} ${data.address.city}`,
    data.address.country,
  ]
    .filter((l): l is string => Boolean(l))
    .join("\n  ");
}

function itemsBlock(data: OrderEmailData): string {
  return data.items
    .map(
      (i) =>
        `  - ${i.productName} (${i.variantName}) × ${i.quantity} : ` +
        formatAmount(i.unitPriceCents * i.quantity, data.currency),
    )
    .join("\n");
}

function totalsBlock(data: OrderEmailData): string {
  // La remise n'apparaît QUE s'il y en a une : une ligne « Remise : 0,00 € »
  // sur toute commande sans code ferait douter d'un bug de calcul.
  return [
    `Sous-total : ${formatAmount(data.subtotalCents, data.currency)}`,
    ...(data.discountCents > 0
      ? [
          `Remise${data.promoCode ? ` (${data.promoCode})` : ""} : −${formatAmount(data.discountCents, data.currency)}`,
        ]
      : []),
    `Livraison  : ${formatAmount(data.shippingCents, data.currency)}`,
    `Total      : ${formatAmount(data.totalCents, data.currency)}`,
  ].join("\n");
}

export function renderOrderConfirmation(data: OrderEmailData): EmailMessage {
  const subject = `Confirmation de votre commande ${data.number}`;
  const bodyText = [
    `Bonjour ${data.customerName},`,
    ``,
    `Nous confirmons la réception de votre commande ${data.number} du ${formatDate(data.placedAt)}.`,
    ``,
    `Articles :`,
    itemsBlock(data),
    ``,
    totalsBlock(data),
    ``,
    `Mode de paiement : ${paymentLabel(data.paymentProvider)}`,
    ``,
    `Adresse de livraison :`,
    `  ${addressBlock(data)}`,
    ``,
    `Merci de votre confiance,`,
    SHOP_NAME,
  ].join("\n");

  const rows = data.items
    .map(
      (i) =>
        `<tr><td>${i.productName} <em>(${i.variantName})</em></td>` +
        `<td style="text-align:right">${i.quantity}</td>` +
        `<td style="text-align:right">${formatAmount(i.unitPriceCents * i.quantity, data.currency)}</td></tr>`,
    )
    .join("");

  const bodyHtml = [
    `<p>Bonjour ${data.customerName},</p>`,
    `<p>Nous confirmons la réception de votre commande <strong>${data.number}</strong> du ${formatDate(data.placedAt)}.</p>`,
    `<table style="border-collapse:collapse;width:100%">`,
    `<thead><tr><th style="text-align:left">Article</th><th style="text-align:right">Qté</th><th style="text-align:right">Montant</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table>`,
    `<p>Sous-total : ${formatAmount(data.subtotalCents, data.currency)}<br>`,
    ...(data.discountCents > 0
      ? [
          `Remise${data.promoCode ? ` (${data.promoCode})` : ""} : −${formatAmount(data.discountCents, data.currency)}<br>`,
        ]
      : []),
    `Livraison : ${formatAmount(data.shippingCents, data.currency)}<br>`,
    `<strong>Total : ${formatAmount(data.totalCents, data.currency)}</strong></p>`,
    `<p>Mode de paiement : ${paymentLabel(data.paymentProvider)}</p>`,
    `<p>Adresse de livraison :<br>${addressBlock(data).replace(/\n/g, "<br>")}</p>`,
    `<p>Merci de votre confiance,<br>${SHOP_NAME}</p>`,
  ].join("\n");

  return {
    to: data.customerEmail,
    subject,
    bodyText,
    bodyHtml,
    template: "order_confirmation",
    orderId: data.id,
  };
}

export type ShipmentEmailInfo = {
  carrier: string;
  trackingNo: string;
};

export function renderOrderShipped(
  data: OrderEmailData,
  shipment: ShipmentEmailInfo,
): EmailMessage {
  const subject = `Votre commande ${data.number} est expédiée`;
  const bodyText = [
    `Bonjour ${data.customerName},`,
    ``,
    `Bonne nouvelle : votre commande ${data.number} vient d'être expédiée.`,
    ``,
    `Transporteur    : ${shipment.carrier}`,
    `Numéro de suivi : ${shipment.trackingNo}`,
    ``,
    `Adresse de livraison :`,
    `  ${addressBlock(data)}`,
    ``,
    `Merci de votre confiance,`,
    SHOP_NAME,
  ].join("\n");

  const bodyHtml = [
    `<p>Bonjour ${data.customerName},</p>`,
    `<p>Bonne nouvelle : votre commande <strong>${data.number}</strong> vient d'être expédiée.</p>`,
    `<p>Transporteur : <strong>${shipment.carrier}</strong><br>`,
    `Numéro de suivi : <strong>${shipment.trackingNo}</strong></p>`,
    `<p>Adresse de livraison :<br>${addressBlock(data).replace(/\n/g, "<br>")}</p>`,
    `<p>Merci de votre confiance,<br>${SHOP_NAME}</p>`,
  ].join("\n");

  return {
    to: data.customerEmail,
    subject,
    bodyText,
    bodyHtml,
    template: "order_shipped",
    orderId: data.id,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Envois
// ─────────────────────────────────────────────────────────────────────

/**
 * Envoie la confirmation de commande. Ne propage JAMAIS d'erreur : un email
 * qui échoue ne doit pas annuler un paiement encaissé. L'échec est loggé, et
 * l'absence de ligne `EmailOutbox` rend le problème visible.
 */
export async function sendOrderConfirmation(orderId: string): Promise<void> {
  try {
    const sender = selectEmailSender();
    const data = await loadOrderEmailData(orderId);
    await sender.send(renderOrderConfirmation(data));
  } catch (err) {
    console.error(`[email] confirmation non envoyée pour ${orderId}`, err);
  }
}

export async function sendOrderShipped(
  orderId: string,
  shipment: ShipmentEmailInfo,
): Promise<void> {
  try {
    const sender = selectEmailSender();
    const data = await loadOrderEmailData(orderId);
    await sender.send(renderOrderShipped(data, shipment));
  } catch (err) {
    console.error(`[email] notification d'expédition non envoyée pour ${orderId}`, err);
  }
}
