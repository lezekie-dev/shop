import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { products: { where: { active: true } } },
      },
    },
  });

  return (
    <section>
      <h1 style={{ marginTop: "1.5rem" }}>Bienvenue</h1>
      <p style={{ color: "#555" }}>
        Découvrez notre sélection de produits physiques, organisée par catégorie.
      </p>

      <h2 style={{ marginTop: "2rem", fontSize: "1.25rem" }}>Catégories</h2>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {categories.map((c) => (
          <li
            key={c.id}
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              padding: "1rem",
            }}
          >
            <Link
              href={`/products?category=${c.slug}`}
              style={{ textDecoration: "none", color: "#111", fontWeight: 600 }}
            >
              {c.name}
            </Link>
            <p style={{ margin: "0.25rem 0 0", color: "#777", fontSize: "0.875rem" }}>
              {c._count.products} produit{c._count.products > 1 ? "s" : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
