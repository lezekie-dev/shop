"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  MAX_AUTHOR_NAME_LENGTH,
  MAX_BODY_LENGTH,
  MAX_RATING,
  MAX_TITLE_LENGTH,
  MIN_BODY_LENGTH,
  MIN_RATING,
} from "@/domain/review";

/**
 * Formulaire de dépôt d'un avis (F2), depuis l'espace client.
 *
 * CE QUE LE FORMULAIRE NE FAIT PAS, ET C'EST VOLONTAIRE :
 *   - il n'envoie ni statut, ni `customerId`, ni nom de modérateur : le serveur
 *     décide de tout, et l'identité vient de la session ;
 *   - il ne prétend pas être une validation. Les bornes affichées ici
 *     (`maxLength`, `required`) sont un confort de saisie ; les mêmes règles
 *     sont revérifiées côté serveur par `validateReviewInput`, qui est la seule
 *     autorité. Un `maxLength` HTML se retire avec les outils du navigateur.
 *
 * `productId` et `orderId` sont passés en props (donc rendus par le serveur à
 * partir de LA commande du client) : le client ne les choisit pas.
 */
export function ReviewForm({
  orderId,
  productId,
  productName,
  defaultAuthorName,
}: {
  orderId: string;
  productId: string;
  productName: string;
  /** Nom repris du compte : proposé, modifiable (le client signe ce qu'il veut). */
  defaultAuthorName: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [authorName, setAuthorName] = useState(defaultAuthorName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/account/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, productId, rating, title, body, authorName }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        details?: Array<{ field?: string; message?: string }>;
      };

      if (!res.ok) {
        // Le message du serveur est déjà actionnable (« vous avez déjà déposé
        // un avis », « commande remboursée »…) : on ne le remplace pas par un
        // « une erreur est survenue » qui obligerait le client à deviner.
        const firstDetail = Array.isArray(data.details)
          ? data.details.find((entry) => entry?.message)?.message
          : undefined;
        setError(firstDetail ?? data.error ?? `L'avis n'a pas pu être envoyé (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }

      setDone(true);
      setBusy(false);
      // La page dépend de l'état en base (avis désormais en attente) :
      // rafraîchir le Server Component évite d'afficher un formulaire périmé.
      router.refresh();
    } catch {
      setError("Erreur réseau : l'avis n'a pas pu être envoyé. Réessayez.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice" role="status">
        <p className="notice__title">Merci, votre avis sera publié après vérification.</p>
        <p style={{ margin: 0 }}>
          Un avis est relu avant publication : il apparaîtra sur la fiche de « {productName} » une
          fois validé par la boutique.
        </p>
      </div>
    );
  }

  return (
    <form className="form review-form" onSubmit={onSubmit}>
      <fieldset className="review-form__rating">
        <legend className="form-field__label">Votre note</legend>
        {/* Champ radio plutôt qu&apos;un widget maison : le clavier, les lecteurs
            d&apos;écran et le mode « une main dans le bus » fonctionnent sans JS. */}
        <div className="review-form__stars">
          {Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, index) => index + MIN_RATING).map(
            (value) => (
              <label key={value} className="review-form__star">
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  required
                />
                <span aria-hidden>{"★".repeat(value)}</span>
                <span className="sr-only">
                  {value} étoile{value > 1 ? "s" : ""}
                </span>
              </label>
            ),
          )}
        </div>
      </fieldset>

      <label className="form-field">
        <span className="form-field__label">Titre (facultatif)</span>
        <input
          type="text"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="En un mot : la coupe, la matière, la livraison…"
        />
      </label>

      <label className="form-field">
        <span className="form-field__label">
          Votre avis <span className="form-field__req">*</span>
        </span>
        <textarea
          rows={5}
          value={body}
          minLength={MIN_BODY_LENGTH}
          maxLength={MAX_BODY_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          required
          placeholder={`Ce que vous avez pensé de « ${productName} »`}
        />
        <p className="form-field__hint">
          {MIN_BODY_LENGTH} caractères minimum, {MAX_BODY_LENGTH} maximum. Ni lien ni balise HTML.
        </p>
      </label>

      <label className="form-field">
        <span className="form-field__label">
          Nom affiché <span className="form-field__req">*</span>
        </span>
        <input
          type="text"
          value={authorName}
          maxLength={MAX_AUTHOR_NAME_LENGTH}
          onChange={(event) => setAuthorName(event.target.value)}
          required
        />
        <p className="form-field__hint">
          Le nom que verront les autres clients (votre prénom par exemple).
        </p>
      </label>

      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={busy || rating === 0}>
        {busy ? "Envoi…" : "Envoyer mon avis"}
      </button>
    </form>
  );
}
