import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReviewStatus } from "@prisma/client";

import { isOrderStatusReviewable } from "@/domain/review";
import { requireCustomer } from "@/lib/customer-auth";
import { listOrderReviewCandidates } from "@/server/reviews";
import { StatusBadge } from "@/ui/components/status-badge";
import { ReviewForm } from "@/ui/components/review-form";
import { IconCheck, IconInfo } from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * « Laisser un avis » sur une commande (`/compte/commandes/[id]/avis`, F2).
 *
 * POURQUOI CETTE PAGE EXISTE ET PAS UN SIMPLE FORMULAIRE SUR LA FICHE PRODUIT
 * Le PO a tranché : un avis est TOUJOURS rattaché à une commande (preuve
 * d'achat). Le point d'entrée est donc la commande, pas le produit — un
 * formulaire sur la fiche produit inviterait n'importe quel visiteur à écrire,
 * ce qui est exactement ce que le périmètre exclut.
 *
 * La page montre l'état RÉEL de chaque article acheté : à noter, ou déjà noté
 * (en attente / publié / non publié). Elle ne propose pas de formulaire pour un
 * article qui sera refusé — un formulaire qu'on remplit pour rien est pire que
 * pas de formulaire.
 *
 * SÉCURITÉ : `listOrderReviewCandidates(customerId, orderId)` filtre sur le
 * `customerId` de la SESSION. La commande d'un autre client renvoie `null`,
 * donc un 404 — jamais un 403 qui confirmerait son existence.
 */

const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING: "En attente de vérification",
  APPROVED: "Publié",
  REJECTED: "Non publié",
};

const REVIEW_STATUS_HINTS: Record<ReviewStatus, string> = {
  PENDING: "Votre avis a bien été reçu. Il apparaîtra sur la fiche produit après relecture.",
  APPROVED: "Votre avis est visible sur la fiche produit. Merci !",
  REJECTED:
    "Cet avis n'a pas été publié. La boutique ne publie pas les propos hors sujet, injurieux ou publicitaires.",
};

export default async function OrderReviewPage({ params }: { params: { id: string } }) {
  const customer = await requireCustomer(`/compte/commandes/${params.id}/avis`);

  const order = await listOrderReviewCandidates(customer.id, params.id);
  if (!order) notFound();

  // Commande annulée ou remboursée : on l'annonce AVANT tout formulaire, avec
  // la même règle que celle appliquée par l'API (`isOrderStatusReviewable`).
  const orderReviewable = isOrderStatusReviewable(order.orderStatus);
  const defaultAuthorName =
    [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.email;

  return (
    <div className="page">
      <div className="page__head enter enter-1">
        <div>
          <p className="eyebrow">
            <Link href="/compte">Mes commandes</Link> ·{" "}
            <Link href={`/compte/commandes/${order.orderId}`}>Commande</Link>
          </p>
          <h1 className="page__title">
            Laisser un avis — commande <span className="num">{order.orderNumber}</span>
          </h1>
          <p className="page__sub">
            Vous pouvez donner votre avis sur les articles de cette commande. Un avis est publié
            après vérification, et un seul avis par produit.
          </p>
        </div>
        <StatusBadge status={order.orderStatus} />
      </div>

      {!orderReviewable ? (
        <div className="notice enter enter-2">
          <p className="notice__title">
            {order.orderStatus === "REFUNDED" ? "Commande remboursée" : "Commande annulée"}
          </p>
          <p>
            Un avis ne peut pas être déposé sur une commande annulée ou remboursée : la preuve
            d&apos;achat n&apos;existe plus.
          </p>
        </div>
      ) : null}

      <div className="section enter enter-2">
        {order.candidates.map((candidate) => (
          <div key={candidate.productId} className="card">
            <h2 className="card__title">
              <Link href={`/products/${candidate.productSlug}`}>{candidate.productName}</Link>
            </h2>
            <p className="line__meta">
              {candidate.variantNames.join(", ")} ·{" "}
              <span className="badge badge-verified">Achat vérifié</span>
            </p>

            {candidate.review ? (
              <div className="notice">
                <p className="notice__title">
                  <IconInfo className="admin-inline-icon" />{" "}
                  {REVIEW_STATUS_LABELS[candidate.review.status]}
                </p>
                <p style={{ margin: 0 }}>{REVIEW_STATUS_HINTS[candidate.review.status]}</p>
              </div>
            ) : !orderReviewable ? (
              <p className="line__meta">
                <IconCheck className="admin-inline-icon" /> Aucun avis possible sur cet article.
              </p>
            ) : (
              <ReviewForm
                orderId={order.orderId}
                productId={candidate.productId}
                productName={candidate.productName}
                defaultAuthorName={defaultAuthorName}
              />
            )}
          </div>
        ))}
      </div>

      <div className="section enter enter-3">
        <Link href={`/compte/commandes/${order.orderId}`} className="btn btn-secondary">
          Retour à la commande
        </Link>
      </div>
    </div>
  );
}
