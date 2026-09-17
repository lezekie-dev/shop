import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoneyEur } from "@/domain/pricing";

export const dynamic = "force-dynamic";

type Search = { category?: string };

export default async function ProductsListPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const categorySlug = searchParams.category;

  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(categorySlug
        ? { category: { slug: categorySlug } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      variants: {
        where: { active: true },
        orderBy: { priceCents: "asc" },
      },
    },
  });

  const items = products
    .map((p) => {
      const minPrice = p.variants.reduce<number | null>(
        (acc, v) => (acc === null || v.priceCents < acc ? v.priceCents : acc),
        null,
      );
      return { product: p, minPrice };
    })
    .sort((a, b) => {
      const av = a.minPrice ?? Number.MAX_SAFE_INTEGER;
      const bv = b.minPrice ?? Number.MAX_SAFE_INTEGER;
      return av - bv;
    });

  return (
    <section>
      <h1 style={{ marginTop: "1.5rem" }}>
        {categorySlug ? `Catégorie : ${categorySlug}` : "Catalogue"}
      </h1>
      {items.length === 0 ? (
        <p style={{ color: "#777" }}>Aucun produit actif pour le moment.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "1rem",
          }}
        >
          {items.map(({ product, minPrice }) => (
            <li
              key={product.id}
              style={{
                background: "#fff",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                padding: "1rem",
              }}
            >
              <Link
                href={`/products/${product.slug}`}
                style={{ textDecoration: "none", color: "#111" }}
              >
                <strong>{product.name}</strong>
              </Link>
              <p
                style={{
                  margin: "0.25rem 0 0",
                  color: "#777",
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {product.category.name}
              </p>
              <p style={{ margin: "0.5rem 0 0", fontWeight: 600 }}>
                {minPrice !== null ? `À partir de ${formatMoneyEur(minPrice)}` : "Prix indisponible"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
