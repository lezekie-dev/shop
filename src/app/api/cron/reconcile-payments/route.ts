import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/server/cron-auth";
import { runPaymentReconciliationJob } from "@/server/payment-reconciliation";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/reconcile-payments
 *
 * Déclencheur MANUEL de la tâche de réconciliation des paiements bloqués, pour
 * un cron système, le planificateur Coolify, ou un `curl` de dépannage :
 *
 *   curl -X POST https://shop.example/api/cron/reconcile-payments \
 *        -H "x-cron-secret: $CRON_SECRET"
 *
 * Aucun service tiers n'est requis (contrainte de cadrage), et le secret
 * protège la route : sans `CRON_SECRET` valide, rien ne s'exécute (401). Un
 * `CRON_SECRET` non configuré donne 503 — jamais un passage libre, qui serait
 * la porte ouverte classique.
 *
 * Codes de retour :
 *   200 la tâche a tourné (des paiements ont pu échouer individuellement, c'est
 *       raconté dans `meta` et `error`, et tracé dans `JobRun`) ;
 *   401 secret absent ou faux ;
 *   500 l'exécution n'a pas pu aboutir (la tâche a tout de même écrit son
 *       `JobRun` FAILED, sauf si la base est injoignable) — un cron doit voir
 *       une sortie en erreur pour que la panne remonte ;
 *   503 `CRON_SECRET` non configuré sur le serveur.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const authorization = authorizeCronRequest(req.headers, {
    CRON_SECRET: process.env.CRON_SECRET,
  });
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  const run = await runPaymentReconciliationJob();

  const body = {
    ok: run.status === "SUCCEEDED",
    jobRunId: run.jobRunId,
    status: run.status,
    meta: run.meta,
    error: run.error,
    checked: run.results.map((result) => ({
      paymentId: result.paymentId,
      orderNumber: result.orderNumber,
      verdict: result.verdict,
      paymentStatus: result.paymentStatus,
    })),
  };

  // Un job en échec répond 500 : c'est ce que lit un planificateur, et c'est
  // aussi ce qui déclenche une alerte côté plateforme. Répondre 200 « tout va
  // bien » sur une exécution ratée est exactement la panne silencieuse que ce
  // chantier doit supprimer.
  return NextResponse.json(body, { status: run.status === "SUCCEEDED" ? 200 : 500 });
}
