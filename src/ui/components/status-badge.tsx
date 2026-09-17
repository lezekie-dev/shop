import { OrderStatus } from "@prisma/client";

const META: Record<
  OrderStatus,
  { label: string; bg: string; fg: string; icon: string }
> = {
  PENDING_PAYMENT: { label: "En attente de paiement", bg: "#fff4e5", fg: "#a05a00", icon: "⏳" },
  PAID: { label: "Payée", bg: "#e6f4ea", fg: "#1e7a36", icon: "✓" },
  PREPARING: { label: "En préparation", bg: "#e8f0fe", fg: "#1a4ea0", icon: "📦" },
  SHIPPED: { label: "Expédiée", bg: "#e8f0fe", fg: "#1a4ea0", icon: "🚚" },
  DELIVERED: { label: "Livrée", bg: "#e6f4ea", fg: "#1e7a36", icon: "🏠" },
  CANCELLED: { label: "Annulée", bg: "#fbe9e7", fg: "#a52a2a", icon: "✕" },
  REFUNDED: { label: "Remboursée", bg: "#f3e8fd", fg: "#5b21b6", icon: "↩" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const m = META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.2rem 0.55rem",
        borderRadius: 999,
        background: m.bg,
        color: m.fg,
        fontSize: "0.8rem",
        fontWeight: 600,
        lineHeight: 1.4,
      }}
      aria-label={`Statut : ${m.label}`}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}
