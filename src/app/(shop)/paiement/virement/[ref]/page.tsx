import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BANK_TRANSFER_VALIDITY_MS,
  bankTransferBic,
  bankTransferDetails,
} from "@/domain/payment/bank-transfer";
import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { formatDate } from "@/ui/format";

export const dynamic = "force-dynamic";

/**
 * Page d'instructions de virement bancaire — cible du `redirectUrl`
 * renvoyé par `BankTransferPaymentProvider.createIntent`.
 *
 * Aucun compte tiers : on affiche simplement où virer l'argent et quelle
 * référence indiquer. Le marchand confirmera ensuite manuellement.
 */
export default async function BankTransferInstructionsPage({
  params,
}: {
  params: { ref: string };
}) {
  const payment = await prisma.payment.findUnique({
    where: {
      provider_providerRef: { provider: "bank_transfer", providerRef: params.ref },
    },
    include: {
      order: {
        select: { id: true, number: true, totalCents: true, currency: true, status: true },
      },
    },
  });

  if (!payment) {
    notFound();
  }

  const details = bankTransferDetails();
  const bic = bankTransferBic();
  const order = payment.order;
  // Même échéance que celle posée par `createIntent` : une seule constante.
  const expiresAt = new Date(payment.createdAt.getTime() + BANK_TRANSFER_VALIDITY_MS);
  const expired = Date.now() > expiresAt.getTime();
  const settled = order.status !== "PENDING_PAYMENT";

  return (
    <div className="page page--slim enter enter-1">
      <div className="page__head">
        <div>
          <p className="eyebrow">Virement bancaire</p>
          <h1 className="page__title">Paiement par virement</h1>
          <p className="page__sub">
            Commande <span className="num">{order.number}</span> —{" "}
            <span className="money">{formatMoneyEur(payment.amountCents)}</span>
          </p>
        </div>
      </div>

      {settled ? (
        <div className="notice">
          <p className="notice__title">Paiement enregistré</p>
          <p>
            Le virement a été rapproché : votre commande n&apos;est plus en attente de paiement.
            Les coordonnées ci-dessous sont conservées à titre de justificatif.
          </p>
        </div>
      ) : (
        <div className="notice">
          <p className="notice__title">Votre commande est réservée</p>
          <p>
            Elle sera validée à réception du virement sur le compte ci-dessous. Le rapprochement
            est fait à la main par la boutique, généralement sous 1 à 2 jours ouvrés.
          </p>
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Coordonnées bancaires</h2>

        <div className="instruction-row">
          <span className="instruction-row__label">Bénéficiaire</span>
          <span className="instruction-row__value">{details.holder}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Banque</span>
          <span className="instruction-row__value">{details.bankName}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">IBAN</span>
          <span className="instruction-row__value num">{details.iban}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">BIC</span>
          <span className="instruction-row__value num">{bic}</span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Montant</span>
          <span className="instruction-row__value num">
            {formatMoneyEur(payment.amountCents)}
          </span>
        </div>
        <div className="instruction-row">
          <span className="instruction-row__label">Référence à indiquer</span>
          <span className="instruction-row__value num">{order.number}</span>
        </div>
      </section>

      <div className="notice">
        <p className="notice__title">
          {expired ? "Délai dépassé" : "La commande expire sans virement"}
        </p>
        <p>
          {expired ? (
            <>
              Le délai de virement de cette commande est dépassé (échéance :{" "}
              <span className="num">{formatDate(expiresAt)}</span>). Contactez la boutique pour
              relancer la commande.
            </>
          ) : (
            <>
              Sans virement reçu avant le <span className="num">{formatDate(expiresAt)}</span>, la
              commande est annulée et les articles sont remis en stock. Indiquez la référence{" "}
              <span className="num">{order.number}</span> dans le libellé : c&apos;est ce qui permet
              de rattacher votre virement à cette commande.
            </>
          )}
        </p>
      </div>

      <div className="actions">
        <Link href={`/orders/${order.id}`} className="btn btn-primary">
          J&apos;ai effectué le virement
        </Link>
        <Link href="/products" className="btn btn-secondary">
          Continuer mes achats
        </Link>
      </div>
    </div>
  );
}
