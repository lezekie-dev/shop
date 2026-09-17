import Link from "next/link";
import { notFound } from "next/navigation";

import { MOBILE_MONEY_OPERATORS, normalizeOperator } from "@/domain/payment/mobile-money";
import { prisma } from "@/lib/db";
import { Money } from "@/ui/components/money";
import { SimulateMobileMoneyPayment } from "@/ui/components/simulate-mobile-money-payment";

export const dynamic = "force-dynamic";

const boxStyle: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  background: "#fff",
  padding: "1rem",
};

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

  return (
    <section
      style={{ padding: "2rem 1rem", maxWidth: 640, margin: "0 auto", display: "grid", gap: "1.25rem" }}
    >
      <header>
        <h1 style={{ margin: 0 }}>Paiement Mobile Money</h1>
        <p style={{ margin: "0.35rem 0 0", color: "#666" }}>
          Commande <strong>{order.number}</strong> —{" "}
          <Money cents={payment.amountCents} currency={payment.currency} />
        </p>
      </header>

      <div style={boxStyle}>
        <p style={{ margin: 0, color: "#777", fontSize: "0.8rem", textTransform: "uppercase" }}>
          Opérateur
        </p>
        <p style={{ margin: "0.15rem 0 0.75rem", fontWeight: 600 }}>
          {info?.label ?? "Mobile Money"}
        </p>

        <p style={{ margin: 0, color: "#777", fontSize: "0.8rem", textTransform: "uppercase" }}>
          Numéro à débiter
        </p>
        <p
          style={{
            margin: "0.15rem 0 0.75rem",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {order.customer.phone ?? "—"}
        </p>

        <p style={{ margin: 0, color: "#777", fontSize: "0.8rem", textTransform: "uppercase" }}>
          Code à composer
        </p>
        <p
          style={{
            margin: "0.15rem 0 0",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "1.1rem",
          }}
        >
          {info?.ussd ?? "—"}
        </p>
      </div>

      <div style={{ ...boxStyle, background: "#fffdf5", borderColor: "#f0e0b0" }}>
        <p style={{ margin: 0, color: "#6b5a20" }}>
          {paid
            ? "Paiement confirmé — votre commande est validée."
            : "Validez la demande de paiement reçue sur votre téléphone (ou via le code ci-dessus). La demande expire au bout de 15 minutes."}
        </p>
      </div>

      {!paid && (
        <SimulateMobileMoneyPayment providerRef={payment.providerRef} orderId={order.id} />
      )}

      <p style={{ margin: 0 }}>
        <Link href={`/orders/${order.id}`} style={{ color: "#111" }}>
          Suivre ma commande
        </Link>
      </p>
    </section>
  );
}
