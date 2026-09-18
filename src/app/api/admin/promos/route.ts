import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { PROMO_CODE_MAX_LENGTH, PROMO_CODE_MIN_LENGTH, PROMO_MAX_PERCENT } from "@/domain/promo";
import { requireApiCapability } from "@/server/guards";
import { createPromoCode, listPromoCodes } from "@/server/promo";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/promos — liste des codes (capacité `promos:read`)
 * POST /api/admin/promos — création d'un code (capacité `promos:write`)
 *
 * ─── POURQUOI `promos:*` ET PAS `settings:write` ────────────────────────
 * La matrice `src/domain/access.ts` / CONVENTIONS §13 ne portait aucune
 * capacité « promotion ». Réutiliser `settings:write` aurait marché par
 * coïncidence (ADMIN l'a, STAFF non), mais le jour où un rôle « marketing »
 * apparaît, il faudrait le distinguer des paramètres PSP — c'est précisément
 * la chasse au `if (role === …)` que §13 interdit. Deux capacités dédiées le
 * règlent une fois pour toutes.
 *
 * Le contrôle est ici, côté handler Node (et pas seulement dans le menu) :
 * une URL d'API s'appelle sans passer par l'interface, et le middleware Next
 * ne couvre jamais `/api/*` (CONVENTIONS §11).
 */

/**
 * Les montants arrivent déjà en MINOR UNITS (entiers) : la conversion depuis
 * une saisie humaine (« 12,50 ») est faite côté formulaire par
 * `parseMinorUnitsInput`, qui ne multiplie jamais un flottant par 100
 * (CONVENTIONS §5). Le contrat d'API reste donc « des entiers », sans
 * ambiguïté possible sur la devise ou sur les décimales.
 */
const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(PROMO_CODE_MIN_LENGTH, `Le code doit faire au moins ${PROMO_CODE_MIN_LENGTH} caractères.`)
    .max(PROMO_CODE_MAX_LENGTH, `Le code ne peut pas dépasser ${PROMO_CODE_MAX_LENGTH} caractères.`)
    .regex(/^[A-Za-z0-9-]+$/, "Lettres A–Z, chiffres et tirets uniquement (sans espace ni accent)."),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.number().int().positive("La remise doit être supérieure à 0."),
  minSubtotalCents: z.number().int().min(0).default(0),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  maxPerCustomer: z.number().int().positive().nullable().optional(),
  // Inactif par défaut à la CRÉATION : activer un code est un geste explicite
  // (AC E1). Le PO refuse qu'un code parte en campagne par oubli d'un champ.
  active: z.boolean().default(false),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await requireApiCapability(req, "promos:read");
  if (!access.ok) return access.response;

  const promos = await listPromoCodes();
  return NextResponse.json({ promos });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await requireApiCapability(req, "promos:write");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;
  // Un `PERCENT` à 95 % est presque toujours une virgule oubliée : on refuse
  // ici, avec un message qui dit quoi corriger (le service revérifie — la
  // règle métier vit à un seul endroit, pas dans le schéma HTTP).
  if (data.kind === "PERCENT" && data.value > PROMO_MAX_PERCENT) {
    return NextResponse.json(
      { error: `Une remise en pourcentage ne peut pas dépasser ${PROMO_MAX_PERCENT} %.` },
      { status: 400 },
    );
  }

  const result = await createPromoCode({
    actorId: access.user.id,
    input: {
      code: data.code,
      kind: data.kind,
      value: data.value,
      minSubtotalCents: data.minSubtotalCents,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
      maxRedemptions: data.maxRedemptions ?? null,
      maxPerCustomer: data.maxPerCustomer ?? null,
      active: data.active,
    },
  });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({ promo: result.promo }, { status: 201 });
}
