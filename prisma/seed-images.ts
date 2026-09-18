import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config({ path: ".env" });
const prisma = new PrismaClient();

/** Attache un visuel de démonstration à chaque produit, selon son slug. */
const MAP: Record<string, string> = {
  "t-shirt-basique-blanc": "tshirt-blanc",
  "t-shirt-basique-noir": "tshirt-noir",
  "casquette-classique": "casquette-noir",
  "sac-tote-canvas": "tote-naturel",
};

async function main() {
  const products = await prisma.product.findMany({ select: { id: true, slug: true, name: true } });
  let n = 0;
  for (const p of products) {
    const base = MAP[p.slug];
    if (!base) { console.log(`  ⚠ pas de visuel pour ${p.slug}`); continue; }
    await prisma.productImage.deleteMany({ where: { productId: p.id } });
    await prisma.productImage.create({
      data: {
        productId: p.id,
        url: `/products/${base}.png`,
        alt: `${p.name} — visuel de démonstration`,
        position: 0,
        width: 800,
        height: 800,
      },
    });
    n++;
  }
  const total = await prisma.productImage.count();
  console.log(`✓ ${n} produits illustrés, ${total} visuels en base`);
  await prisma.$disconnect();
  process.exit(0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
