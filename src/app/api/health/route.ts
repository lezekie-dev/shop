import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";
import { probeDatabase } from "@/server/health";

export const dynamic = "force-dynamic";

/**
 * Sonde de santé (`GET /api/health`).
 *
 * ─── CONTRAT ──────────────────────────────────────────────────────────
 *  200 `{ ok: true,  version, db: "up",   durationMs }` — la base répond
 *  503 `{ ok: false, version, db: "down", durationMs }` — la base ne répond pas
 *
 * POURQUOI 503 ET NON 200 QUAND LA BASE EST MORTE (AC J1)
 * C'était le comportement précédent : `200 { db: "down" }`. Une sonde qui
 * répond « tout va bien » alors que la base est morte ne sert à rien — le
 * healthcheck Docker, le tunnel Cloudflare et le cron de surveillance lisent
 * tous le CODE HTTP, pas le corps JSON. On ne peut pas surveiller sans erreur
 * exploitable, donc l'échec devient un statut d'échec.
 *
 * CE QUI N'EST PAS DANS LA RÉPONSE (et pourquoi)
 * Aucun secret, aucune chaîne de connexion, aucun message d'erreur brut : cette
 * route est publique. Un message d'erreur Prisma contient l'hôte, le port, le
 * nom de la base et parfois l'utilisateur — de quoi cartographier l'infra
 * depuis l'extérieur. La cause exacte de la panne vit dans les logs serveur,
 * pas ici.
 *
 * DÉLAI BORNÉ : la vérification est limitée à 2 s (cf. `src/server/health.ts`).
 * Le `Cache-Control: no-store` évite qu'un intermédiaire (tunnel, proxy) serve
 * une réponse « up » vieille de plusieurs minutes.
 */
export async function GET() {
  const { db, durationMs } = await probeDatabase({
    ping: () => prisma.$queryRaw`SELECT 1`,
  });

  return NextResponse.json(
    { ok: db === "up", version: APP_VERSION, db, durationMs },
    { status: db === "up" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
