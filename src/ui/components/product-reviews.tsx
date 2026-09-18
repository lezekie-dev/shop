import Link from "next/link";

import { formatRating, toDisplayText, type RatingSummary } from "@/domain/review";
import type { PublishedReview } from "@/server/reviews";
import { ReviewStars } from "@/ui/components/review-stars";
import { formatDate } from "@/ui/format";

/**
 * Bloc « Avis clients » de la fiche produit (F1).
 *
 * COMPOSANT DE PRÉSENTATION : il ne fait aucune requête, il reçoit des données
 * déjà lues (`PublishedReview`) et une note déjà calculée. C'est ce qui rend la
 * règle « n'affiche rien s'il n'y a pas d'avis publié » vérifiable en test sans
 * base de données : `ReviewsSection` appelé avec `summary = null` retourne
 * `null`, point.
 *
 * ÉTAT VIDE HONNÊTE (exigence explicite du PO) : quand il n'y a aucun avis
 * approuvé, on ne rend NI « 0/5 », NI cinq étoiles vides, NI un faux compteur,
 * et pas même un « Soyez le premier à donner votre avis » — un produit sans avis
 * est un produit sans avis. Le composant retourne `null` plutôt que de rendre un
 * bloc vide : c'est la seule forme qui ne peut pas être contournée par un style
 * qui rendrait un bloc vide visible.
 *
 * Les textes proviennent de clients : ils passent par `toDisplayText` (retrait
 * du balisage, liens cassés) et sont rendus en TEXTE. Aucun
 * `dangerouslySetInnerHTML` dans ce fichier — la seule occurrence du projet
 * concerne le JSON-LD, construit à partir de nombres.
 */
export function ReviewsSection({
  productName,
  summary,
  reviews,
  page,
  pageCount,
  productHref,
}: {
  productName: string;
  /** `null` quand aucun avis n'est approuvé → le bloc n'est pas rendu du tout. */
  summary: RatingSummary | null;
  reviews: readonly PublishedReview[];
  page: number;
  pageCount: number;
  /** URL de base de la fiche (pour la pagination `?avis=N`). */
  productHref: string;
}) {
  if (summary === null) return null;

  return (
    <section className="card reviews" aria-labelledby="reviews-title">
      <h2 className="card__title" id="reviews-title">
        Avis clients
      </h2>

      {/* Synthèse : la note d'abord, le nombre ensuite. Les deux sont du TEXTE,
          pas seulement des étoiles — cf. commentaire de `ReviewStars`. */}
      <p className="reviews__summary">
        <ReviewStars rating={summary.rounded} label={`${formatRating(summary.rounded)} sur 5`} />
        <span className="money money--lg">{formatRating(summary.rounded)}</span>
        <span className="reviews__count">
          sur {summary.count} avis publié{summary.count > 1 ? "s" : ""}
        </span>
      </p>

      <ul className="reviews__list">
        {reviews.map((review) => (
          <li key={review.id} className="review">
            <div className="review__head">
              <ReviewStars rating={review.rating} />
              <p className="review__author">{toDisplayText(review.authorName)}</p>
              <p className="review__meta">
                {formatDate(review.createdAt)}
                {/* Preuve d'achat : le PO demande la mention explicite (F1). */}
                {review.verifiedPurchase ? (
                  <>
                    {" · "}
                    <span className="badge badge-verified">Achat vérifié</span>
                  </>
                ) : null}
              </p>
            </div>
            {review.title ? <p className="review__title">{toDisplayText(review.title)}</p> : null}
            <p className="review__body">{toDisplayText(review.body)}</p>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav className="reviews__pagination" aria-label={`Autres avis sur ${productName}`}>
          {page > 1 ? (
            <Link href={`${productHref}?avis=${page - 1}#avis`} className="btn btn-secondary">
              ← Avis plus récents
            </Link>
          ) : null}
          <span className="line__meta">
            Page {page} sur {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={`${productHref}?avis=${page + 1}#avis`} className="btn btn-secondary">
              Avis plus anciens →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
