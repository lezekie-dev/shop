import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AddToCartForm } from "@/ui/components/add-to-cart-form";

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

  const variants = product.variants.map((v) => {
    const reserved = v.stock?.reserved ?? 0;
    const quantity = v.stock?.quantity ?? 0;
    const available = Math.max(0, quantity - reserved);
    return {
      id: v.id,
      name: v.name,
      priceCents: v.priceCents,
      available,
    };
  });

  return (
    <article style={{ maxWidth: 720 }}>
      <p style={{ color: "#777", fontSize: "0.85rem", textTransform: "uppercase" }}>
        {product.category.name}
      </p>
      <h1 style={{ marginTop: "0.25rem" }}>{product.name}</h1>
      <p style={{ color: "#333" }}>{product.description}</p>

      {variants.length === 0 ? (
        <p style={{ marginTop: "1.5rem", color: "#666" }}>Ce produit n&apos;a pas de variante disponible.</p>
      ) : (
        <AddToCartForm variants={variants} />
      )}
    </article>
  );
}
