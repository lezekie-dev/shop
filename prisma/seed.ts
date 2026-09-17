import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

// Charge .env à la racine (tsx ne le fait pas par défaut, contrairement à `next dev`).
// Priorité à .env.local s'il existe, puis .env.
config({ path: ".env.local" });
config({ path: ".env" });

const prisma = new PrismaClient();

type VariantSeed = {
  sku: string;
  name: string;
  priceCents: number;
  attributes: Record<string, string>;
  quantity: number;
};

type ProductSeed = {
  slug: string;
  name: string;
  description: string;
  categoryId: string;
  variants: VariantSeed[];
};

async function main() {
  const adminEmail = "admin@shop.local";
  const adminPassword = "admin1234";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash },
    create: {
      email: adminEmail,
      passwordHash,
      role: "ADMIN",
    },
  });
  console.log(`✓ admin: ${admin.email} / ${adminPassword}`);

  const categories = [
    { slug: "vetements", name: "Vêtements" },
    { slug: "accessoires", name: "Accessoires" },
  ];
  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: c,
    });
  }
  console.log(`✓ ${categories.length} catégories`);

  const vetements = await prisma.category.findUniqueOrThrow({ where: { slug: "vetements" } });
  const accessoires = await prisma.category.findUniqueOrThrow({ where: { slug: "accessoires" } });

  const products: ProductSeed[] = [
    {
      slug: "t-shirt-basique-blanc",
      name: "T-shirt basique blanc",
      description: "T-shirt 100% coton bio, coupe régulière. Lavable en machine à 30°.",
      categoryId: vetements.id,
      variants: [
        { sku: "TSHIRT-BLANC-S", name: "Blanc / S", priceCents: 1990, attributes: { color: "blanc", size: "S" }, quantity: 25 },
        { sku: "TSHIRT-BLANC-M", name: "Blanc / M", priceCents: 1990, attributes: { color: "blanc", size: "M" }, quantity: 30 },
        { sku: "TSHIRT-BLANC-L", name: "Blanc / L", priceCents: 1990, attributes: { color: "blanc", size: "L" }, quantity: 18 },
      ],
    },
    {
      slug: "t-shirt-basique-noir",
      name: "T-shirt basique noir",
      description: "T-shirt 100% coton bio, coupe régulière, coloris noir profond.",
      categoryId: vetements.id,
      variants: [
        { sku: "TSHIRT-NOIR-S", name: "Noir / S", priceCents: 1990, attributes: { color: "noir", size: "S" }, quantity: 20 },
        { sku: "TSHIRT-NOIR-M", name: "Noir / M", priceCents: 1990, attributes: { color: "noir", size: "M" }, quantity: 22 },
        { sku: "TSHIRT-NOIR-L", name: "Noir / L", priceCents: 1990, attributes: { color: "noir", size: "L" }, quantity: 15 },
      ],
    },
    {
      slug: "sac-tote-canvas",
      name: "Sac tote en canvas",
      description: "Grand sac tote en toile canvas épaisse, anses renforcées. Idéal pour le quotidien.",
      categoryId: accessoires.id,
      variants: [
        { sku: "TOTE-NAT", name: "Naturel", priceCents: 1490, attributes: { color: "naturel" }, quantity: 40 },
        { sku: "TOTE-NOIR", name: "Noir", priceCents: 1490, attributes: { color: "noir" }, quantity: 35 },
      ],
    },
    {
      slug: "casquette-classique",
      name: "Casquette classique",
      description: "Casquette 6 panneaux, ajustable, broderie ton sur ton.",
      categoryId: accessoires.id,
      variants: [
        { sku: "CASQ-BEIGE", name: "Beige", priceCents: 2490, attributes: { color: "beige" }, quantity: 12 },
        { sku: "CASQ-NOIR", name: "Noir", priceCents: 2490, attributes: { color: "noir" }, quantity: 18 },
        { sku: "CASQ-KAKI", name: "Kaki", priceCents: 2490, attributes: { color: "kaki" }, quantity: 8 },
      ],
    },
  ];

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        active: true,
      },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        active: true,
      },
    });

    for (const v of p.variants) {
      const variant = await prisma.variant.upsert({
        where: { sku: v.sku },
        update: {
          name: v.name,
          priceCents: v.priceCents,
          attributes: v.attributes,
          active: true,
          productId: product.id,
        },
        create: {
          sku: v.sku,
          name: v.name,
          priceCents: v.priceCents,
          attributes: v.attributes,
          productId: product.id,
        },
      });

      await prisma.stock.upsert({
        where: { variantId: variant.id },
        update: { quantity: v.quantity, reserved: 0 },
        create: { variantId: variant.id, quantity: v.quantity, reserved: 0 },
      });
    }
  }
  console.log(`✓ ${products.length} produits avec variantes et stock`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // dotenv garde un fd ouvert sur .env, ce qui empêche Node de terminer
    // proprement. On force la sortie pour que `npm run prisma:seed` ne
    // timeout pas dans les hooks Prisma / Vitest.
    process.exit(0);
  });
