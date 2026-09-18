import { NextResponse, type NextRequest } from "next/server";

import { requireApiCapability } from "@/server/guards";
import { reconcilePaymentById } from "@/server/payment-reconciliation";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payments/[id]/reconcile — action « Vérifier maintenant ».
 *
 * Réinterroge le fournisseur d'origine pour CE paiement, sans attendre la
 * prochaine exécution de la tâche (user story I3 : Jules doit pouvoir débloquer
 * une commande maintenant).
 *
 * CAPACITÉ `orders:read` ET NON « ADMIN » : cette action fait exactement ce que
 * la tâche planifiée fait toute seule toutes les heures. La réserver à ADMIN
 * donnerait à l'opérateur un écran qu'il ne peut pas utiliser, tout en laissant
 * la même transition se produire sans lui la nuit — une restriction qui
 * n'apporte aucune sécurité. Ce qui reste réservé, c'est la DÉCISION de
 * confirmer un encaissement (voir le bouton « Marquer payé » de la page), qui
 * passe par `orders:transition:paid` et donc par la matrice §13.
 *
 * La route ne fait AUCUNE transition de paiement elle-même : elle délègue à
 * `reconcilePaymentById`, qui passe par `applyPaymentOutcome`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireApiCapability(req, "orders:read");
  if (!access.ok) return access.response;

  const result = await reconcilePaymentById(params.id);
  if (!result) {
    return NextResponse.json(
      { error: `Paiement introuvable : ${params.id}`, code: "PAYMENT_NOT_FOUND" },
      { status: 404 },
    );
  }

  // Un verdict « error » n'est pas un succès de vérification : l'appelant doit
  // pouvoir le distinguer sans lire le texte français. 502 = le fournisseur
  // n'a pas répondu correctement, ce n'est pas notre requête qui est fautive.
  return NextResponse.json(
    {
      ok: result.verdict !== "error",
      paymentId: result.paymentId,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      verdict: result.verdict,
      paymentStatus: result.paymentStatus,
      orderStatus: result.orderStatus,
      idempotent: result.idempotent,
      reconcileAttempts: result.reconcileAttempts,
      nextReconcileAt: result.nextReconcileAt,
      message: result.message,
    },
    { status: result.verdict === "error" ? 502 : 200 },
  );
}
