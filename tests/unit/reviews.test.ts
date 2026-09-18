import { describe, expect, it } from "vitest";
import type { OrderStatus, ReviewStatus } from "@prisma/client";

import {
  aggregateRatingJsonLd,
  checkReviewEligibility,
  computeRatingSummary,
  containsHtml,
  containsUrl,
  formatAgeInDays,
  formatRating,
  isModerationOverdue,
  isOrderStatusReviewable,
  MAX_BODY_LENGTH,
  MAX_RATING,
  MAX_TITLE_LENGTH,
  MIN_BODY_LENGTH,
  MIN_RATING,
  MODERATION_OVERDUE_DAYS,
  reviewAgeInDays,
  toDisplayText,
  validateReviewInput,
} from "@/domain/review";

/**
 * Avis clients — logique pure (chantier F).
 *
 * Ce que ce fichier verrouille, et pourquoi ces cas-là :
 *   - la validation (note hors bornes, texte trop court/long, HTML, URL) : le
 *     formulaire d'avis est la seule surface d'écriture publique de la
 *     boutique (risque R5), donc la validation serveur est la vraie frontière ;
 *   - l'éligibilité (produit non commandé, commande annulée/remboursée) : un
 *     avis sans preuve d'achat est un faux avis possible ;
 *   - la note moyenne ne compte QUE les avis approuvés, et vaut `null` (donc
 *     « rien à afficher ») quand il n'y en a aucun ;
 *   - l'ancienneté en modération, qui porte le critère « 0 avis en attente de
 *     plus de 7 jours ».
 *
 * Aucune base, aucun mock : `src/domain/review.ts` est pur et reçoit `now` en
 * paramètre (CONVENTIONS §2).
 */

const NOW = new Date("2026-09-18T12:00:00.000Z");

function daysBefore(days: number, hours = 0): Date {
  return new Date(NOW.getTime() - days * 86_400_000 - hours * 3_600_000);
}

describe("validation d'une saisie d'avis", () => {
  const VALID = {
    rating: 4,
    title: "Très bon achat",
    body: "La coupe est fidèle à la photo et la livraison a été rapide.",
    authorName: "Aïcha N.",
  };

  it("accepte une saisie nominale et normalise le titre vide en null", () => {
    const result = validateReviewInput(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rating).toBe(4);
    expect(result.value.title).toBe("Très bon achat");
    expect(result.value.body).toBe(VALID.body);
    expect(result.value.authorName).toBe("Aïcha N.");

    const noTitle = validateReviewInput({ ...VALID, title: "   " });
    expect(noTitle.ok).toBe(true);
    if (noTitle.ok) expect(noTitle.value.title).toBeNull();
  });

  it("refuse une note hors bornes (0, 6, non entière, absente)", () => {
    for (const rating of [0, 6, -1, 3.5, Number.NaN, "5", null, undefined]) {
      const result = validateReviewInput({ ...VALID, rating });
      expect(result.ok, `note refusée attendue pour ${String(rating)}`).toBe(false);
      if (!result.ok) expect(result.errors.map((e) => e.field)).toContain("rating");
    }
    // Les bornes elles-mêmes restent valides.
    for (const rating of [MIN_RATING, MAX_RATING]) {
      expect(validateReviewInput({ ...VALID, rating }).ok).toBe(true);
    }
  });

  it("refuse un texte trop court et un texte trop long", () => {
    const short = validateReviewInput({ ...VALID, body: "Bon" });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.errors.find((e) => e.field === "body")?.message).toContain(
        String(MIN_BODY_LENGTH),
      );
    }

    const long = validateReviewInput({ ...VALID, body: "a".repeat(MAX_BODY_LENGTH + 1) });
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.errors.find((e) => e.field === "body")?.message).toContain(
        String(MAX_BODY_LENGTH),
      );
    }

    // La borne exacte passe : un « off-by-one » sur la limite est un bug
    // silencieux (l'utilisateur est refusé à un caractère près).
    expect(validateReviewInput({ ...VALID, body: "a".repeat(MAX_BODY_LENGTH) }).ok).toBe(true);
    expect(validateReviewInput({ ...VALID, body: "a".repeat(MIN_BODY_LENGTH) }).ok).toBe(true);
  });

  it("refuse un titre trop long", () => {
    const result = validateReviewInput({ ...VALID, title: "x".repeat(MAX_TITLE_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.field)).toContain("title");
  });

  it("refuse le HTML dans le texte et dans le titre", () => {
    for (const payload of [
      { ...VALID, body: "Super produit <script>alert(1)</script> à recommander chaudement" },
      { ...VALID, body: "Bonjour <b>je recommande</b> vraiment cet article" },
      { ...VALID, title: "<a href='http://spam.example'>Promo</a>" },
    ]) {
      const result = validateReviewInput(payload);
      expect(result.ok).toBe(false);
    }
    expect(containsHtml("<script>")).toBe(true);
    expect(containsHtml("texte normal")).toBe(false);
  });

  it("refuse une URL dans le texte", () => {
    for (const body of [
      "Achetez moins cher ici : https://arnaques.example",
      "Mon site www.mon-site.example vous accueille, article correct.",
      "Écrivez-moi sur hxxp://contournement.example et je vous explique",
      "Regarde mon lien https ://espace.example et dis-moi ce que tu en penses, merci",
    ]) {
      const result = validateReviewInput({ ...VALID, body });
      expect(result.ok, `URL non refusée dans : ${body}`).toBe(false);
    }
    expect(containsUrl("texte normal, sans lien")).toBe(false);
    // Une URL sans espace dans la résolution (`https://`) est bien détectée.
    expect(containsUrl("https://x.example")).toBe(true);
  });

  it("cumule les erreurs au lieu de n'en signaler qu'une", () => {
    const result = validateReviewInput({ rating: 9, body: "", title: "x".repeat(200), authorName: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("rating");
      expect(fields).toContain("body");
      expect(fields).toContain("title");
      expect(fields).toContain("authorName");
    }
  });
});

describe("neutralisation à l'affichage", () => {
  it("retire le balisage et casse les liens d'un texte douteux", () => {
    const rendered = toDisplayText("<script>alert(1)</script> offre https://exemple.example");
    expect(rendered).not.toContain("<");
    expect(rendered).not.toContain(">");
    // Le schéma est cassé : la chaîne ne contient plus de `https://` littéral,
    // donc aucun navigateur ni client mail ne peut en faire un lien.
    // (`containsUrl` reste, lui, volontairement insensible aux espaces : c'est
    // la fonction de DÉTECTION, qui doit rattraper les écritures déguisées du
    // type « h t t p s : / / ».)
    expect(rendered).not.toContain("https://");
    // Le contenu textuel, lui, n'est pas escamoté : le client lit ce qui a été
    // écrit, sans le balisage.
    expect(rendered).toContain("alert(1)");
  });
});

describe("note moyenne et répartition", () => {
  function ratings(values: Array<[number, ReviewStatus]>) {
    return values.map(([rating, status]) => ({ rating, status }));
  }

  it("ne compte QUE les avis approuvés", () => {
    const summary = computeRatingSummary(
      ratings([
        [5, "APPROVED"],
        [3, "APPROVED"],
        [1, "PENDING"],
        [1, "REJECTED"],
      ]),
    );
    expect(summary).not.toBeNull();
    expect(summary?.count).toBe(2);
    expect(summary?.average).toBe(4);
    expect(summary?.distribution[5]).toBe(1);
    expect(summary?.distribution[3]).toBe(1);
    // Un avis en attente ou rejeté n'apparaît dans AUCUNE case.
    expect(summary?.distribution[1]).toBe(0);
  });

  it("arrondit la moyenne à une décimale", () => {
    const summary = computeRatingSummary(
      ratings([
        [4, "APPROVED"],
        [3, "APPROVED"],
        [3, "APPROVED"],
      ]),
    );
    // 10 / 3 = 3,333… → 3,3
    expect(summary?.rounded).toBe(3.3);
    expect(formatRating(3.3)).toBe("3,3");
  });

  it("renvoie null quand aucun avis n'est approuvé (état vide honnête)", () => {
    expect(computeRatingSummary([])).toBeNull();
    expect(computeRatingSummary(ratings([[5, "PENDING"]]))).toBeNull();
    expect(computeRatingSummary(ratings([[5, "REJECTED"]]))).toBeNull();
  });

  it("ignore une note corrompue hors bornes plutôt que de fausser la moyenne", () => {
    const summary = computeRatingSummary(
      ratings([
        [5, "APPROVED"],
        [9, "APPROVED"],
      ]),
    );
    expect(summary?.count).toBe(1);
    expect(summary?.average).toBe(5);
  });
});

describe("balisage AggregateRating (JSON-LD)", () => {
  it("n'est produit que s'il existe des avis approuvés", () => {
    expect(aggregateRatingJsonLd(null)).toBeNull();

    const summary = computeRatingSummary([
      { rating: 5, status: "APPROVED" },
      { rating: 4, status: "APPROVED" },
    ]);
    const ld = aggregateRatingJsonLd(summary);
    expect(ld).not.toBeNull();
    expect(ld?.["@type"]).toBe("AggregateRating");
    // Point décimal anglo-saxon pour les moteurs, virgule pour l'affichage.
    expect(ld?.ratingValue).toBe("4.5");
    expect(formatRating(summary?.rounded ?? 0)).toBe("4,5");
    expect(ld?.reviewCount).toBe(2);
  });
});

describe("éligibilité d'un avis", () => {
  it("accepte un produit réellement acheté sur une commande non annulée", () => {
    for (const status of [
      "PENDING_PAYMENT",
      "PAID",
      "PREPARING",
      "SHIPPED",
      "DELIVERED",
    ] satisfies OrderStatus[]) {
      expect(isOrderStatusReviewable(status)).toBe(true);
      expect(
        checkReviewEligibility({ orderStatus: status, productOrdered: true, alreadyReviewed: false })
          .ok,
      ).toBe(true);
    }
  });

  it("refuse une commande annulée ou remboursée", () => {
    for (const status of ["CANCELLED", "REFUNDED"] satisfies OrderStatus[]) {
      expect(isOrderStatusReviewable(status)).toBe(false);
      const verdict = checkReviewEligibility({
        orderStatus: status,
        productOrdered: true,
        alreadyReviewed: false,
      });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe("ORDER_CANCELLED");
        expect(verdict.message.length).toBeGreaterThan(20);
      }
    }
  });

  it("refuse un produit qui ne fait pas partie de la commande", () => {
    const verdict = checkReviewEligibility({
      orderStatus: "DELIVERED",
      productOrdered: false,
      alreadyReviewed: false,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("PRODUCT_NOT_ORDERED");
  });

  it("refuse un second avis sur le même produit, avec un message clair", () => {
    const verdict = checkReviewEligibility({
      orderStatus: "DELIVERED",
      productOrdered: true,
      alreadyReviewed: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe("ALREADY_REVIEWED");
      expect(verdict.message).toMatch(/déjà/i);
    }
  });

  it("le statut de la commande est examiné AVANT le doublon (raison la plus utile)", () => {
    const verdict = checkReviewEligibility({
      orderStatus: "REFUNDED",
      productOrdered: true,
      alreadyReviewed: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe("ORDER_CANCELLED");
  });
});

describe("ancienneté en modération (KPI K8)", () => {
  it("compte des jours pleins, sans arrondir vers le haut", () => {
    expect(reviewAgeInDays(NOW, NOW)).toBe(0);
    expect(reviewAgeInDays(daysBefore(0, 23), NOW)).toBe(0);
    expect(reviewAgeInDays(daysBefore(6, 23), NOW)).toBe(6);
    expect(reviewAgeInDays(daysBefore(7), NOW)).toBe(7);
  });

  it("ne produit jamais un âge négatif si l'horloge serveur recule", () => {
    const future = new Date(NOW.getTime() + 3 * 86_400_000);
    expect(reviewAgeInDays(future, NOW)).toBe(0);
  });

  it("déclenche le retard au 7ᵉ jour, pas au 8ᵉ", () => {
    expect(isModerationOverdue(daysBefore(6, 23), NOW)).toBe(false);
    expect(isModerationOverdue(daysBefore(MODERATION_OVERDUE_DAYS), NOW)).toBe(true);
    expect(MODERATION_OVERDUE_DAYS).toBe(7);
  });

  it("formate l'ancienneté en français", () => {
    expect(formatAgeInDays(0)).toBe("aujourd'hui");
    expect(formatAgeInDays(1)).toBe("1 jour");
    expect(formatAgeInDays(12)).toBe("12 jours");
  });
});
