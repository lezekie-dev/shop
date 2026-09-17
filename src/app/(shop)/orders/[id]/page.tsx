import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db";
import { StatusBadge } from "@/ui/components/status-badge";
import { Money } from "@/ui/components/money";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      items: true,
      address: true,
      customer: { select: { email: true, firstName: true, lastName: true, phone: true } },
      payments: { select: { provider: true, status: true, amountCents: true, currency: true } },
    },
  });

  if (!order) {
    notFound();
  }

  return (
    <section style={{ padding: "1rem 0", display: "grid", gap: "1.25rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Commande {order.number}</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#777", fontSize: "0.9rem" }}>
            Passée le {new Date(order.placedAt).toLocaleString("fr-FR")}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 280px",
          gap: "1.5rem",
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: "1rem" }}>
          <Card title="Articles">
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
              {order.items.map((i) => (
                <li
                  key={i.id}
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem" }}
                >
                  <div>
                    <strong>{i.productNameSnapshot}</strong>
                    <p style={{ margin: "0.1rem 0 0", color: "#666", fontSize: "0.85rem" }}>
                      {i.variantNameSnapshot} · Qté {i.quantity}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Money cents={i.unitPriceCents} />
                    <p style={{ margin: "0.1rem 0 0", color: "#666", fontSize: "0.8rem" }}>
                      <Money cents={i.quantity * i.unitPriceCents} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Adresse de livraison">
            <p style={{ margin: 0, fontSize: "0.9rem" }}>
              {order.customer.firstName} {order.customer.lastName}
              <br />
              {order.address.line1}
              {order.address.line2 ? <><br />{order.address.line2}</> : null}
              <br />
              {order.address.postalCode} {order.address.city}
              <br />
              {order.address.country}
              <br />
              <span style={{ color: "#666" }}>{order.customer.email}</span>
            </p>
          </Card>
        </div>

        <aside style={{ display: "grid", gap: "1rem" }}>
          <Card title="Total">
            <Row label="Sous-total" cents={order.subtotalCents} />
            <Row label="Livraison" cents={order.shippingCents} />
            <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "0.5rem 0" }} />
            <Row label="Total" cents={order.totalCents} bold />
          </Card>

          <Card title="Paiement">
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.9rem", display: "grid", gap: "0.25rem" }}>
              {order.payments.map((p, idx) => (
                <li key={idx}>
                  {p.provider} · {p.status} · <Money cents={p.amountCents} currency={p.currency} />
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      <p>
        <Link href="/" style={{ color: "#666" }}>
          Retour à l&apos;accueil
        </Link>
      </p>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        background: "#fff",
        padding: "1rem",
      }}
    >
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, cents, bold }: { label: string; cents: number; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", margin: "0.15rem 0" }}>
      <span style={{ color: bold ? "#111" : "#666", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <Money cents={cents} />
    </div>
  );
}
