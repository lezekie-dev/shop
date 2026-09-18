import { MAX_RATING } from "@/domain/review";

/**
 * Note en étoiles — présentation pure, aucune dépendance (ni client, ni base).
 *
 * POURQUOI DES ÉTOILES ET PAS UN NOMBRE SEUL : sur mobile (3G, écrans étroits),
 * une note se lit d'un coup d'œil en étoiles et demande une lecture attentive en
 * chiffres. Les deux sont affichés côte à côte.
 *
 * ACCESSIBILITÉ — la couleur et la forme NE PORTENT JAMAIS L'INFORMATION
 * SEULES : les étoiles pleines sont complétées par un libellé texte
 * (« 4 sur 5 ») lu par les lecteurs d'écran, et le `title` reprend la valeur.
 * Une note accessible seulement visuellement est une note perdue pour qui ne
 * voit pas les étoiles.
 */
export function ReviewStars({ rating, label }: { rating: number; label?: string }) {
  const filled = Math.max(0, Math.min(MAX_RATING, Math.round(rating)));

  return (
    <span className="review-stars" title={label ?? `${filled} sur ${MAX_RATING}`}>
      <span aria-hidden className="review-stars__glyphs">
        {"★".repeat(filled)}
        {"☆".repeat(MAX_RATING - filled)}
      </span>
      <span className="sr-only">{label ?? `Note : ${filled} sur ${MAX_RATING}`}</span>
    </span>
  );
}
