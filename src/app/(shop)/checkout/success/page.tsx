import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";

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
    <section
      style={{
        padding: "2rem 1rem",
        textAlign: "center",
        display: "grid",
        gap: "1rem",
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div aria-hidden style={{ fontSize: "2.5rem" }}>
        ✓
      </div>
      <h1 style={{ margin: 0 }}>Merci pour votre commande&nbsp;!</h1>
      <p style={{ color: "#666", margin: 0 }}>
        Votre paiement a bien été pris en compte (mode test). Vous recevrez un email
        de confirmation dès que possible.
      </p>
      <p
        style={{
          margin: "1rem 0 0",
          padding: "0.75rem 1rem",
          border: "1px solid #e5e5e5",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        Numéro de commande&nbsp;: <strong>{orderNumber}</strong>
      </p>
      <p>
        <Link
          href={`/orders/${orderId}`}
          style={{
            display: "inline-block",
            padding: "0.75rem 1.25rem",
            background: "#111",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Voir ma commande
        </Link>
      </p>
      <p>
        <Link href="/products" style={{ color: "#666" }}>
          Continuer mes achats
        </Link>
      </p>
    </section>
  );
}
