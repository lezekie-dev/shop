/**
 * Change le mot de passe d'un compte admin.
 *
 *   npx tsx scripts/set-admin-password.ts <email> <nouveau-mot-de-passe>
 *
 * Pourquoi un script et pas un formulaire web : changer le mot de passe
 * lui-même est une opération sensible. Tant qu'elle passe par une page, cette
 * page est une surface d'attaque supplémentaire (CSRF, session volée). En CLI,
 * il faut déjà avoir un accès shell au serveur — donc le niveau de privilège
 * qu'on exige pour modifier les identifiants.
 *
 * Le mot de passe n'est pas passé par une variable d'environnement (visible
 * dans `ps` et l'historique) mais en argument positionnel, et n'est jamais
 * loggué.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const prisma = new PrismaClient();

/** Longueur minimale exigée : en dessous, un bruteforce aboutit. */
const MIN_LENGTH = 12;

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error("Usage : npx tsx scripts/set-admin-password.ts <email> <mot-de-passe>");
    process.exit(2);
  }
  if (password.length < MIN_LENGTH) {
    console.error(
      `Mot de passe trop court (${password.length} caractères). Minimum ${MIN_LENGTH}.`,
    );
    process.exit(2);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`Aucun compte admin avec l'email ${email}.`);
    const all = await prisma.user.findMany({ select: { email: true } });
    if (all.length > 0) {
      console.error("Comptes existants :");
      for (const u of all) console.error(`  - ${u.email}`);
    }
    process.exit(1);
  }

  const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);
  const passwordHash = await bcrypt.hash(password, rounds);

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // Toutes les sessions ouvertes sont révoquées : un changement de mot de passe
  // qui laisse les sessions en cours valides ne protège pas si le mot de passe
  // a fuité (l'attaquant garde son accès).
  const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });

  console.log(`✓ Mot de passe mis à jour pour ${email}`);
  console.log(`✓ ${count} session(s) révoquée(s) — reconnexion nécessaire partout`);
  console.log(`✓ Tentatives de connexion échouées remises à zéro`);
  await prisma.loginAttempt.deleteMany({ where: { identifier: email.toLowerCase() } });

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
