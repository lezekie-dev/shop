import { describe, expect, it } from "vitest";

import {
  computeDiscountCents,
  describePromoStatus,
  evaluatePromo,
  formatPromoAmount,
  isValidPromoCode,
  normalizePromoCode,
  parseMinorUnitsInput,
  PROMO_MAX_PERCENT,
  totalWithDiscountCents,
  type PromoRule,
} from "@/domain/promo";

/**
 * Logique PURE des codes promo (chantier E) — aucun accès base, aucune horloge
 * implicite : `now` est toujours passé par le test.
 *
 * C'est l'intérêt du découpage : les onze cas limites du PO (expiré, pas
 * commencé, plafond global, plafond client, minimum d'achat, remise bornée…)
 * se vérifient ici en quelques millisecondes. Les mêmes scénarios rejoués en
 * intégration coûteraient une base et un TRUNCATE par test.
 */

const NOW = new Date("2026-09-18T12:00:00.000Z");

function rule(overrides: Partial<PromoRule> = {}): PromoRule {
  return {
    code: "BIENVENUE",
    kind: "PERCENT",
    value: 10,
    minSubtotalCents: 0,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    maxPerCustomer: null,
    active: true,
    ...overrides,
  };
}

const NO_USAGE = { totalRedemptions: 0, customerRedemptions: 0 };

// ─────────────────────────────────────────────────────────────────────
// Calcul de la remise
// ─────────────────────────────────────────────────────────────────────

describe("computeDiscountCents", () => {
  it("PERCENT 10 sur un sous-total de 10 000 → 1 000 (cas du PO)", () => {
    expect(computeDiscountCents({ kind: "PERCENT", value: 10 }, 10_000)).toBe(1_000);
  });

  it("FIXED 20 000 sur un sous-total de 5 000 → 5 000, jamais -15 000 (cas du PO)", () => {
    // Le total ne peut PAS devenir négatif : une remise fixe plus grande que le
    // panier offre le panier, pas un remboursement déguisé.
    expect(computeDiscountCents({ kind: "FIXED", value: 20_000 }, 5_000)).toBe(5_000);
  });

  it("arrondit le pourcentage vers le BAS, jamais vers le haut", () => {
    // 3 % de 999 = 29,97 → 29. Arrondir au supérieur offrirait un centime de
    // plus que le pourcentage annoncé, sur chaque commande d'une campagne.
    expect(computeDiscountCents({ kind: "PERCENT", value: 3 }, 999)).toBe(29);
  });

  it("ne remise rien sur un panier à 0 ou avec une valeur aberrante", () => {
    expect(computeDiscountCents({ kind: "PERCENT", value: 10 }, 0)).toBe(0);
    expect(computeDiscountCents({ kind: "FIXED", value: 0 }, 5_000)).toBe(0);
    expect(computeDiscountCents({ kind: "FIXED", value: -500 }, 5_000)).toBe(0);
  });

  it("rend toujours un ENTIER (aucun flottant dans le chemin de montant)", () => {
    for (const subtotal of [1, 7, 999, 1_234, 99_999]) {
      for (const percent of [1, 5, 33, 90]) {
        const discount = computeDiscountCents({ kind: "PERCENT", value: percent }, subtotal);
        expect(Number.isInteger(discount)).toBe(true);
        expect(discount).toBeLessThanOrEqual(subtotal);
      }
    }
  });
});

describe("totalWithDiscountCents", () => {
  it("PERCENT 10 sur 10 000 + 590 de livraison → 9 590 (cas du PO)", () => {
    expect(
      totalWithDiscountCents({ subtotalCents: 10_000, shippingCents: 590, discountCents: 1_000 }),
    ).toBe(9_590);
  });

  it("FIXED supérieure au sous-total → le total vaut la livraison seule", () => {
    expect(
      totalWithDiscountCents({ subtotalCents: 5_000, shippingCents: 590, discountCents: 20_000 }),
    ).toBe(590);
  });

  it("ne remise JAMAIS la livraison", () => {
    // La livraison gratuite par code est hors périmètre (décision du PO) : un
    // code ne peut pas annuler les frais de port.
    const total = totalWithDiscountCents({
      subtotalCents: 1_000,
      shippingCents: 590,
      discountCents: 1_000,
    });
    expect(total).toBe(590);
  });

  it("un total ne peut pas être négatif, même avec une remise incohérente", () => {
    expect(
      totalWithDiscountCents({ subtotalCents: 100, shippingCents: 0, discountCents: 999_999 }),
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

describe("evaluatePromo — cas nominaux", () => {
  it("accepte un code dans sa fenêtre et rend la remise", () => {
    const result = evaluatePromo({ rule: rule(), subtotalCents: 10_000, now: NOW, usage: NO_USAGE });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe("BIENVENUE");
      expect(result.discountCents).toBe(1_000);
    }
  });

  it("refuse avec une raison EXPLICITE quand le code n'existe pas", () => {
    const result = evaluatePromo({ rule: null, subtotalCents: 10_000, now: NOW, usage: NO_USAGE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("NOT_FOUND");
      // Jamais un « code invalide » générique : le client doit pouvoir agir.
      expect(result.message).toContain("n'existe pas");
    }
  });

  it("refuse un code désactivé", () => {
    const result = evaluatePromo({
      rule: rule({ active: false }),
      subtotalCents: 10_000,
      now: NOW,
      usage: NO_USAGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INACTIVE");
  });

  it("refuse un code pas encore commencé, en donnant la date de début", () => {
    const startsAt = new Date("2026-10-01T00:00:00.000Z");
    const result = evaluatePromo({
      rule: rule({ startsAt }),
      subtotalCents: 10_000,
      now: NOW,
      usage: NO_USAGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("NOT_STARTED");
      expect(result.message).toContain("2026");
      expect(result.date?.getTime()).toBe(startsAt.getTime());
    }
  });

  it("refuse un code expiré, en donnant la date de fin", () => {
    const endsAt = new Date("2026-09-01T00:00:00.000Z");
    const result = evaluatePromo({
      rule: rule({ endsAt }),
      subtotalCents: 10_000,
      now: NOW,
      usage: NO_USAGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("EXPIRED");
      expect(result.message).toContain("2026");
      expect(result.date?.getTime()).toBe(endsAt.getTime());
    }
  });

  it("refuse un panier sous le minimum d'achat et CHIFFRE ce qui manque", () => {
    const result = evaluatePromo({
      rule: rule({ minSubtotalCents: 5_000 }),
      subtotalCents: 3_750,
      now: NOW,
      usage: NO_USAGE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("MIN_SUBTOTAL");
      expect(result.missingCents).toBe(1_250);
      // Le montant manquant est la seule information qui permet au client de
      // compléter son panier — sans lui, il devine.
      expect(result.message).toContain(formatPromoAmount(1_250));
      expect(result.message).toContain(formatPromoAmount(5_000));
    }
  });

  it("refuse quand le plafond global est atteint", () => {
    const result = evaluatePromo({
      rule: rule({ maxRedemptions: 3 }),
      subtotalCents: 10_000,
      now: NOW,
      usage: { totalRedemptions: 3, customerRedemptions: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MAX_REDEMPTIONS");
  });

  it("accepte le dernier usage disponible du plafond global", () => {
    const result = evaluatePromo({
      rule: rule({ maxRedemptions: 3 }),
      subtotalCents: 10_000,
      now: NOW,
      usage: { totalRedemptions: 2, customerRedemptions: 0 },
    });
    expect(result.ok).toBe(true);
  });

  it("refuse quand le client a déjà consommé son quota", () => {
    const result = evaluatePromo({
      rule: rule({ maxPerCustomer: 1 }),
      subtotalCents: 10_000,
      now: NOW,
      usage: { totalRedemptions: 1, customerRedemptions: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MAX_PER_CUSTOMER");
  });

  it("refuse une règle mal configurée au lieu d'offrir une remise absurde", () => {
    // Un « 950 % » saisi à la place de « 9,50 » est la faute de frappe type :
    // elle doit être refusée, jamais convertie en panier gratuit.
    for (const bad of [rule({ kind: "PERCENT", value: 95 }), rule({ value: 0 })]) {
      const result = evaluatePromo({ rule: bad, subtotalCents: 10_000, now: NOW, usage: NO_USAGE });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("INVALID_VALUE");
    }
  });

  it("une limite de date n'est jamais un motif de fuite : à la seconde près", () => {
    const endsAt = new Date("2026-09-18T12:00:00.000Z");
    // Juste avant : accepté. Juste après : refusé.
    const before = evaluatePromo({
      rule: rule({ endsAt }),
      subtotalCents: 1_000,
      now: new Date(endsAt.getTime() - 1),
      usage: NO_USAGE,
    });
    const after = evaluatePromo({
      rule: rule({ endsAt }),
      subtotalCents: 1_000,
      now: new Date(endsAt.getTime() + 1),
      usage: NO_USAGE,
    });
    expect(before.ok).toBe(true);
    expect(after.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Normalisation des codes
// ─────────────────────────────────────────────────────────────────────

describe("normalizePromoCode", () => {
  it("« bienvenue » et « BIENVENUE » désignent le MÊME code", () => {
    expect(normalizePromoCode("bienvenue")).toBe("BIENVENUE");
    expect(normalizePromoCode("  Bienvenue  ")).toBe("BIENVENUE");
    expect(normalizePromoCode("bienvenue")).toBe(normalizePromoCode("BIENVENUE"));
  });

  it("accepte la forme attendue (3–24 caractères, A–Z, 0–9, tiret)", () => {
    expect(isValidPromoCode("BIENVENUE")).toBe(true);
    expect(isValidPromoCode("NOEL-2026")).toBe(true);
    expect(isValidPromoCode("bienvenue")).toBe(true);
  });

  it("refuse une forme inutilisable : le client tape ce qu'il voit sur l'affiche", () => {
    expect(isValidPromoCode("AB")).toBe(false); // trop court
    expect(isValidPromoCode("A".repeat(25))).toBe(false); // trop long
    expect(isValidPromoCode("BIEN VENUE")).toBe(false); // espace
    expect(isValidPromoCode("BIENVENUE_2026")).toBe(false); // underscore
    expect(isValidPromoCode("ÉTÉ2026")).toBe(false); // accent
  });
});

describe("parseMinorUnitsInput", () => {
  it("convertit une saisie humaine en minor units ENTIERS", () => {
    expect(parseMinorUnitsInput("12")).toBe(1_200);
    expect(parseMinorUnitsInput("12,50")).toBe(1_250);
    expect(parseMinorUnitsInput("12.5")).toBe(1_250);
    expect(parseMinorUnitsInput("0")).toBe(0);
  });

  it("n'utilise aucune multiplication flottante (piège du 12,13)", () => {
    // `Number("12,13".replace(",", ".")) * 100` donne 1212,9999999999998.
    // Ici le résultat est exact, parce que la partie décimale est lue comme un
    // entier — c'est la règle « aucun Float » des CONVENTIONS §5.
    expect(parseMinorUnitsInput("12,13")).toBe(1_213);
    expect(parseMinorUnitsInput("0,01")).toBe(1);
    expect(parseMinorUnitsInput("1234567,89")).toBe(123_456_789);
  });

  it("refuse une saisie non exploitable plutôt que de deviner", () => {
    expect(parseMinorUnitsInput("")).toBeNull();
    expect(parseMinorUnitsInput("abc")).toBeNull();
    expect(parseMinorUnitsInput("-5")).toBeNull();
    expect(parseMinorUnitsInput("1,234")).toBeNull(); // 3 décimales
    expect(parseMinorUnitsInput("1.2.3")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Statut affiché en administration
// ─────────────────────────────────────────────────────────────────────

describe("describePromoStatus", () => {
  const base = { active: true, startsAt: null, endsAt: null, maxRedemptions: null };
  const none = { totalRedemptions: 0, customerRedemptions: 0 };

  it("déduit les cinq statuts attendus par le PO", () => {
    expect(describePromoStatus(base, none, NOW)).toBe("ACTIVE");
    expect(describePromoStatus({ ...base, active: false }, none, NOW)).toBe("DISABLED");
    expect(
      describePromoStatus({ ...base, startsAt: new Date("2026-10-01T00:00:00Z") }, none, NOW),
    ).toBe("SCHEDULED");
    expect(
      describePromoStatus({ ...base, endsAt: new Date("2026-09-01T00:00:00Z") }, none, NOW),
    ).toBe("EXPIRED");
    expect(
      describePromoStatus({ ...base, maxRedemptions: 5 }, { ...none, totalRedemptions: 5 }, NOW),
    ).toBe("EXHAUSTED");
  });

  it("« désactivé » l'emporte : c'est la seule cause sur laquelle on peut agir", () => {
    expect(
      describePromoStatus(
        { active: false, startsAt: null, endsAt: new Date("2026-09-01T00:00:00Z"), maxRedemptions: 1 },
        { totalRedemptions: 9, customerRedemptions: 0 },
        NOW,
      ),
    ).toBe("DISABLED");
  });
});

describe("PROMO_MAX_PERCENT", () => {
  it("plafonne une remise en pourcentage à 90 % (garde-fou de marge)", () => {
    expect(PROMO_MAX_PERCENT).toBe(90);
  });
});
