import Link from "next/link";
import { notFound } from "next/navigation";

import { bankTransferDetails } from "@/domain/payment/bank-transfer";
import { prisma } from "@/lib/db";
import { Money } from "@/ui/components/money";

export const dynamic = "force-dynamic";

const boxStyle: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  background: "#fff",
  padding: "1rem",
};

const labelStyle: React.CSSProperties = {
  color: "#777",
  fontSize: "0.8rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  margin: 0,
};

const valueStyle: React.CSSProperties = {
  margin: "0.15rem 0 0.75rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "1rem",
};

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
  const order = payment.order;

  return (
    <section style={{ padding: "2rem 1rem", maxWidth: 640, margin: "0 auto", display: "grid", gap: "1.25rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>Paiement par virement bancaire</h1>
        <p style={{ margin: "0.35rem 0 0", color: "#666" }}>
          Commande <strong>{order.number}</strong> —{" "}
          <Money cents={payment.amountCents} currency={payment.currency} />
        </p>
      </header>

      <div style={boxStyle}>
        <p style={labelStyle}>Bénéficiaire</p>
        <p style={valueStyle}>{details.holder}</p>

        <p style={labelStyle}>Banque</p>
        <p style={valueStyle}>{details.bankName}</p>

        <p style={labelStyle}>IBAN</p>
        <p style={valueStyle}>{details.iban}</p>

        <p style={labelStyle}>Référence à indiquer dans le libellé</p>
        <p style={{ ...valueStyle, marginBottom: 0 }}>{order.number}</p>
      </div>

      <div style={{ ...boxStyle, background: "#fffdf5", borderColor: "#f0e0b0" }}>
        <p style={{ margin: 0, color: "#6b5a20" }}>
          Votre commande est <strong>en attente de paiement</strong>. Elle sera validée dès
          réception du virement sur le compte ci-dessus (validation manuelle par la boutique,
          généralement sous 1 à 2 jours ouvrés).
        </p>
      </div>

      <p style={{ margin: 0 }}>
        <Link href={`/orders/${order.id}`} style={{ color: "#111" }}>
          Suivre ma commande
        </Link>
      </p>
    </section>
  );
}
