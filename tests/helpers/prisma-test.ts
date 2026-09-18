/**
 * Helpers de test d'intégration — Prisma réel sur shop_test.
 *
 * Stratégie : TRUNCATE toutes les tables métier entre chaque test
 * (cf. §9 de ARCHITECTURE.md), puis ré-seed pour avoir admin + produits.
 *
 * ⚠ N'utilise QUE shop_test (DATABASE_URL_TEST). Ne JAMAIS importer
 * ce fichier depuis un test qui tape sur la base dev.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { newId } from "@/lib/ids";

export const prismaTest = new PrismaClient({
  log: ["error"],
});

/**
 * Vide TOUTES les tables du schéma `public`, en une seule instruction.
 *
 * ── Pourquoi la liste est découverte à l'exécution ──────────────────
 * La version précédente énumérait 17 tables à la main. Le schéma en compte 29
 * depuis les chantiers V1 (Review, PromoCode, Wishlist, JobRun…). Une liste
 * manuelle devient silencieusement fausse à chaque migration : les tables
 * oubliées ne sont jamais vidées, et un test hérite des données du précédent.
 * La panne est d'autant plus vicieuse qu'elle est intermittente et dépend de
 * l'ordre d'exécution des fichiers.
 *
 * ── Pourquoi UNE instruction et non une par table ───────────────────
 * `TRUNCATE` prend un verrou `AccessExclusiveLock` par table. En lançant 29
 * TRUNCATE séparés dans une même transaction (l'ancienne écriture :
 * `$transaction(TABLES.map(t => $executeRawUnsafe(...)))`), les verrous
 * s'attendent mutuellement : Postgres sérialise, et un test qui faisait 6
 * passes de nettoyage dépassait le délai de 30 s — jusqu'à faire tomber un
 * agent d'implémentation resté bloqué 30 minutes dessus. Une seule instruction
 * groupée ne prend qu'un verrou par table, dans un ordre unique et
 * déterministe.
 *
 * `RESTART IDENTITY` est inutile ici : toutes les clés primaires du projet
 * sont des `cuid()` générés par Prisma, il n'existe aucune séquence à
 * réinitialiser (vérifié : `pg_sequences` est vide). Le conserver ne coûte
 * que des verrous supplémentaires.
 *
 * Mesure : 29 tables vidées en ~1,5 s contre ~5 s avec 29 TRUNCATE parallèles.
 */
export async function resetDb(): Promise<void> {
  const rows = await prismaTest.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;

  // Les noms viennent du catalogue système de Postgres, pas d'une entrée
  // utilisateur : l'interpolation est sûre. Les guillemets protègent les
  // identifiants sensibles à la casse (`OrderItem`, `EmailOutbox`).
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await prismaTest.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

/**
 * Ré-exécute le seed minimal (admin + catégories + 4 produits + variants + stock)
 * et renvoie les ids utiles pour les tests.
 */
export async function seedFixtures(): Promise<{
  adminId: string;
  categories: { vetements: string; accessoires: string };
  products: Record<string, { id: string; slug: string; variants: Array<{ id: string; sku: string; priceCents: number; stock: number }> }>;
}> {
  const passwordHash = await bcrypt.hash("admin1234", 4);
  const admin = await prismaTest.user.upsert({
    where: { email: "admin@shop.local" },
    update: { passwordHash },
    create: { email: "admin@shop.local", passwordHash, role: "ADMIN" },
  });

  const vetements = await prismaTest.category.upsert({
    where: { slug: "vetements" },
    update: { name: "Vêtements" },
    create: { slug: "vetements", name: "Vêtements" },
  });
  const accessoires = await prismaTest.category.upsert({
    where: { slug: "accessoires" },
    update: { name: "Accessoires" },
    create: { slug: "accessoires", name: "Accessoires" },
  });

  const productDefs = [
    {
      slug: "t-shirt-basique-blanc",
      name: "T-shirt basique blanc",
      description: "T-shirt coton bio.",
      categoryId: vetements.id,
      variants: [
        { sku: "TSHIRT-BLANC-S", name: "Blanc / S", priceCents: 1990, quantity: 25 },
        { sku: "TSHIRT-BLANC-M", name: "Blanc / M", priceCents: 1990, quantity: 30 },
      ],
    },
    {
      slug: "sac-tote-canvas",
      name: "Sac tote en canvas",
      description: "Sac tote.",
      categoryId: accessoires.id,
      variants: [
        { sku: "TOTE-NAT", name: "Naturel", priceCents: 1490, quantity: 40 },
        { sku: "TOTE-NOIR", name: "Noir", priceCents: 1490, quantity: 35 },
      ],
    },
  ];

  const products: Record<string, { id: string; slug: string; variants: Array<{ id: string; sku: string; priceCents: number; stock: number }> }> = {};
  for (const p of productDefs) {
    const product = await prismaTest.product.upsert({
      where: { slug: p.slug },
      update: { name: p.name, description: p.description, categoryId: p.categoryId, active: true },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        active: true,
      },
    });
    const variants = [];
    for (const v of p.variants) {
      const variant = await prismaTest.variant.upsert({
        where: { sku: v.sku },
        update: {
          name: v.name,
          priceCents: v.priceCents,
          attributes: {},
          productId: product.id,
          active: true,
        },
        create: {
          sku: v.sku,
          name: v.name,
          priceCents: v.priceCents,
          attributes: {},
          productId: product.id,
        },
      });
      await prismaTest.stock.upsert({
        where: { variantId: variant.id },
        update: { quantity: v.quantity, reserved: 0 },
        create: { variantId: variant.id, quantity: v.quantity, reserved: 0 },
      });
      variants.push({ id: variant.id, sku: v.sku, priceCents: v.priceCents, stock: v.quantity });
    }
    products[p.slug] = { id: product.id, slug: p.slug, variants };
  }

  return {
    adminId: admin.id,
    categories: { vetements: vetements.id, accessoires: accessoires.id },
    products,
  };
}

/**
 * Crée un Cart ACTIVE direct en DB (utile pour les tests API : on contrôle
 * l'id retourné dans le cookie).
 */
export async function createActiveCart(items: Array<{ variantId: string; quantity: number; unitPriceCents: number }>) {
  const cart = await prismaTest.cart.create({
    data: {
      id: newId(),
      status: "ACTIVE",
      currency: "EUR",
      items: {
        create: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
        })),
      },
    },
  });
  return cart;
}
