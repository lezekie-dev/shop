import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoneyEur } from "@/domain/pricing";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: {
      category: true,
      variants: {
        where: { active: true },
        orderBy: { priceCents: "asc" },
        include: { stock: true },
      },
    },
  });

  if (!product || !product.active) {
    notFound();
  }

  return (
    <article style={{ maxWidth: 720 }}>
      <p style={{ color: "#777", fontSize: "0.85rem", textTransform: "uppercase" }}>
        {product.category.name}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{product.name}</h1>
      <p style={{ color: "#333" }}>{product.description}</p>

      <form
        action="/api/cart/items"
        method="post"
        style={{ marginTop: "2rem", display: "grid", gap: "1rem" }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span>Variante</span>
          <select
            name="variantId"
            required
            style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
          >
            {product.variants.map((v) => {
              const stock = v.stock?.quantity ?? 0;
              const disabled = stock <= 0;
              return (
                <option key={v.id} value={v.id} disabled={disabled}>
                  {v.name} — {formatMoneyEur(v.priceCents)}
                  {disabled ? " (rupture)" : ""}
                </option>
              );
            })}
          </select>
        </label>

        <label style={{ display: "grid", gap: "0.25rem", maxWidth: 160 }}>
          <span>Quantité</span>
          <input
            type="number"
            name="quantity"
            min={1}
            defaultValue={1}
            required
            style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <button
          type="submit"
          disabled
          title="Disponible au sprint 2"
          style={{
            padding: "0.75rem 1rem",
            background: "#111",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            cursor: "not-allowed",
            opacity: 0.6,
            width: "fit-content",
          }}
        >
          Ajouter au panier (S2)
        </button>
        <p style={{ color: "#999", fontSize: "0.8rem", margin: 0 }}>
          Le panier arrive au Sprint 2.
        </p>
      </form>
    </article>
  );
}
