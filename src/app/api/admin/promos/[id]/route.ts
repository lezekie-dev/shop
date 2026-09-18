import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { PROMO_CODE_MAX_LENGTH, PROMO_CODE_MIN_LENGTH } from "@/domain/promo";
import { requireApiCapability } from "@/server/guards";
import { updatePromoCode } from "@/server/promo";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/promos/[id] — modification et (dés)activation d'un code.
 *
 * Capacité `promos:write` (ADMIN). Le patch est PARTIEL : l'écran d'activation
 * n'envoie que `{ active: false }`, et un champ absent ne doit pas être
 * écrasé par sa valeur par défaut — c'est le piège classique d'un PATCH qui
 * réécrit tout l'objet avec des `undefined` silencieux.
 */

const patchSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(PROMO_CODE_MIN_LENGTH)
      .max(PROMO_CODE_MAX_LENGTH)
      .regex(/^[A-Za-z0-9-]+$/, "Lettres A–Z, chiffres et tirets uniquement.")
      .optional(),
    kind: z.enum(["PERCENT", "FIXED"]).optional(),
    value: z.number().int().positive().optional(),
    minSubtotalCents: z.number().int().min(0).optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    maxPerCustomer: z.number().int().positive().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Aucun champ à modifier.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "promos:write");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Champs invalides", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const patch = parsed.data;
  const result = await updatePromoCode({
    actorId: access.user.id,
    promoId: params.id,
    patch: {
      ...(patch.code !== undefined ? { code: patch.code } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      ...(patch.minSubtotalCents !== undefined ? { minSubtotalCents: patch.minSubtotalCents } : {}),
      ...(patch.startsAt !== undefined
        ? { startsAt: patch.startsAt ? new Date(patch.startsAt) : null }
        : {}),
      ...(patch.endsAt !== undefined
        ? { endsAt: patch.endsAt ? new Date(patch.endsAt) : null }
        : {}),
      ...(patch.maxRedemptions !== undefined ? { maxRedemptions: patch.maxRedemptions } : {}),
      ...(patch.maxPerCustomer !== undefined ? { maxPerCustomer: patch.maxPerCustomer } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
  });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({ promo: result.promo });
}
