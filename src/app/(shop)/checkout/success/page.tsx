import Link from "next/link";
import { redirect } from "next/navigation";

import { formatMoneyEur } from "@/domain/pricing";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/ui/components/status-badge";

export const dynamic = "force-dynamic";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: { orderId?: string; n?: string };
}) {
  const orderId = searchParams.orderId;
  if (!orderId) {
    redirect("/cart");
  }
  // Récupère le numéro (fallback sur searchParams.n si la DB a un délai)
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { number: true, status: true, totalCents: true, currency: true },
  });
  const orderNumber = order?.number ?? searchParams.n ?? "—";

  return (
    <div className="confirm enter enter-1">
      <span className="confirm__emoji" aria-hidden>
        ✓
      </span>
      <h1>Merci&nbsp;!</h1>
      <p className="confirm__lead">
        Votre paiement a bien été pris en compte. Vous recevrez un email de confirmation dès que la
        boutique aura traité la commande.
      </p>

      <div className="card confirm__card">
        <p className="eyebrow">Numéro de commande</p>
        <strong className="num">{orderNumber}</strong>
        {order && (
          <>
            <span className="money money--lg">{formatMoneyEur(order.totalCents)}</span>
            <StatusBadge status={order.status} />
          </>
        )}
      </div>

      <div className="confirm__actions">
        <Link href={`/orders/${orderId}`} className="btn btn-primary">
          Voir ma commande
        </Link>
        <Link href="/products" className="btn btn-secondary">
          Continuer mes achats
        </Link>
      </div>
    </div>
  );
}
