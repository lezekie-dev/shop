import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonFailure } from "@/lib/api-response";
import { moderateReview } from "@/server/reviews";
import { requireApiCapability } from "@/server/guards";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/reviews/[id] — approbation ou rejet d'un avis (F3).
 *
 * CAPACITÉ `reviews:moderate` et non un rôle en dur (CONVENTIONS §13) : la
 * matrice vit dans `src/domain/access.ts` et elle seule décide qui modère.
 *
 * Deux garanties portées par `moderateReview` :
 *   - `moderatedById` + `moderatedAt` sont écrits avec le nouveau statut ;
 *   - un `AuditLog` (`review.approve` / `review.reject`) est écrit dans la même
 *     transaction, avec le motif libre de rejet — le schéma n'ayant pas de
 *     colonne pour ce motif, la piste d'audit est sa place définitive.
 *
 * Le second modérateur qui clique après coup reçoit 409 avec un message clair,
 * jamais un écrasement silencieux de la décision du premier.
 */

const moderationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  // Motif libre : borné pour ne pas transformer la piste d'audit en dépotoir,
  // facultatif (approuver n'a pas besoin de justification).
  reason: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "reviews:moderate");
  if (!access.ok) return access.response;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalide", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = moderationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Décision invalide", code: "INVALID_INPUT", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await moderateReview({
    actorId: access.user.id,
    reviewId: params.id,
    decision: parsed.data.decision,
    reason: parsed.data.reason ?? null,
  });
  if (!result.ok) return jsonFailure(result);

  return NextResponse.json({
    review: { id: result.review.id, status: result.review.status },
    message:
      result.review.status === "APPROVED"
        ? "Avis approuvé : il est désormais visible sur la fiche produit."
        : "Avis rejeté : il ne sera jamais publié.",
  });
}
