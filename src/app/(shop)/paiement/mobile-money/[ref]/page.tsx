import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MOBILE_MONEY_OPERATORS,
  MOBILE_MONEY_REQUEST_TTL_MS,
  normalizeOperator,
} from "@/domain/payment/mobile-money";
import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { Money } from "@/ui/components/money";
import { SimulateMobileMoneyPayment } from "@/ui/components/simulate-mobile-money-payment";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

/** `mm_ORANGE_<cuid2>` → "ORANGE" */
function operatorFromRef(providerRef: string): string | null {
  const parts = providerRef.split("_");
  return parts.length >= 2 ? (parts[1] ?? null) : null;
}

/**
 * Page d'instruction Mobile Money — cible du `redirectUrl` renvoyé par
 * `MobileMoneyPaymentProvider.createIntent`.
 *
 * Reproduit ce que fait un vrai push USSD : on demande au client de composer
 * le code de son opérateur et de valider, puis l'opérateur notifie la boutique
 * de façon asynchrone (ici via le callback simulé).
 */
export default async function MobileMoneyInstructionsPage({
  params,
}: {
  params: { ref: string };
}) {
  const payment = await prisma.payment.findUnique({
    where: {
      provider_providerRef: { provider: "mobile_money", providerRef: params.ref },
    },
    include: {
      order: {
        select: {
          id: true,
          number: true,
          accessToken: true,
          totalCents: true,
          currency: true,
          status: true,
          customer: { select: { phone: true } },
        },
      },
    },
  });

  if (!payment) {
    notFound();
  }

  const rawOperator = operatorFromRef(params.ref);
  const operator = rawOperator ? normalizeOperator(rawOperator) : null;
  const info = MOBILE_MONEY_OPERATORS.find((o) => o.code === operator) ?? null;
  const order = payment.order;
  const paid = order.status !== "PENDING_PAYMENT";
  const expiresAt = new Date(payment.createdAt.getTime() + MOBILE_MONEY_REQUEST_TTL_MS);
  const expired = !paid && Date.now() > expiresAt.getTime();
  const phone = order.customer.phone;

  return (
    <div className="page page--slim enter enter-1">
      <div className="page__head">
        <div>
          <p className="eyebrow">Mobile Money</p>
          <h1 className="page__title">Paiement Mobile Money</h1>
          <p className="page__sub">
            Commande <span className="num">{order.number}</span> —{" "}
            <span className="money">{formatMoneyEur(payment.amountCents)}</span>
          </p>
        </div>
      </div>

      <div className="notice">
        <p className="notice__title">
          {paid
            ? "Paiement confirmé"
            : expired
              ? "Demande expirée"
              : "Validez la demande reçue sur votre téléphone"}
        </p>
        <p>
          {paid
            ? "Le paiement a été confirmé par l'opérateur : votre commande est validée et va être préparée."
            : expired
              ? "Cette demande de paiement a expiré. Aucun montant n'a été débité : relancez une commande pour recevoir une nouvelle demande."
              : "Une demande de paiement a été envoyée sur votre téléphone. Elle expire au bout de 15 minutes : passé ce délai, il faut relancer la commande."}
        </p>
      </div>

      <section className="card">
        <h2 className="card__title">Comment payer</h2>
        <ol className="steps-list">
          <li>
            Ouvrez le menu Mobile Money de votre téléphone ({info?.label ?? "Mobile Money"}).
          </li>
          <li>
            Composez le code{" "}
            <span className="steps-list__code num">{info?.ussd ?? "—"}</span> pour ouvrir le
            service de paiement marchand.
          </li>
          <li>
            Saisissez le montant <span className="money">{formatMoneyEur(payment.amountCents)}</span>{" "}
            puis validez avec votre code secret.
          </li>
          <li>
            Le compte débité est le{" "}
            <span className="num">{phone ?? "—"}</span> — c&apos;est le numéro laissé lors de la
            commande.
          </li>
          <li>
            La boutique est prévenue automatiquement par l&apos;opérateur. Il n&apos;y a rien
            d&apos;autre à faire : cette page se met à jour toute seule.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2 className="card__title">Détails de la demande</h2>

        <div className="instruction-row">
          <span className="instruction-row__label">Opérateur</span>
          <span className="instruction-row__value">{info?.label ?? "Mobile Money"}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Numéro à débiter</span>
          <span className="instruction-row__value num">{phone ?? "—"}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Code à composer</span>
          <span className="instruction-row__value num">{info?.ussd ?? "—"}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Montant</span>
          <span className="instruction-row__value num">
            {formatMoneyEur(payment.amountCents)}
          </span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Référence</span>
          <span className="instruction-row__value num">{payment.providerRef}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">{expired ? "Expirée le" : "Expire le"}</span>
          <span className="instruction-row__value num">{formatDateTime(expiresAt)}</span>
        </div>
      </section>

      {!paid && !expired && (
        <SimulateMobileMoneyPayment providerRef={payment.providerRef} orderId={order.id} />
      )}

      <div className="actions">
        <Link
          href={`/orders/${order.id}?token=${order.accessToken}`}
          className="btn btn-primary"
        >
          Suivre ma commande
        </Link>
        <Link href="/products" className="btn btn-secondary">
          Continuer mes achats
        </Link>
      </div>

      <p className="note">
        Montant total de la commande :{" "}
        <span className="money">
          <Money cents={order.totalCents} currency={order.currency} />
        </span>
        .
      </p>
    </div>
  );
}
