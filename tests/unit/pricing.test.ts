import { describe, expect, it } from "vitest";
import { formatMoneyEur, linesTotalCents } from "@/domain/pricing";

describe("formatMoneyEur", () => {
  it("formate 1990 centimes en 19,90 €", () => {
    expect(formatMoneyEur(1990)).toBe("19,90 €");
  });

  it("formate 0 centime", () => {
    expect(formatMoneyEur(0)).toBe("0,00 €");
  });

  it("formate un montant avec zéro centime", () => {
    expect(formatMoneyEur(5000)).toBe("50,00 €");
  });

  it("formate un montant avec un seul centime", () => {
    expect(formatMoneyEur(1)).toBe("0,01 €");
  });

  it("formate un montant négatif", () => {
    expect(formatMoneyEur(-1990)).toBe("-19,90 €");
  });

  it("utilise le séparateur des milliers français (espace insécable fin)", () => {
    // ICU/CLDR récent utilise U+202F (espace insécable fin) comme séparateur de milliers.
    // On accepte les deux variantes pour rester compatible Node 18+ et Node 22+.
    expect(formatMoneyEur(123456)).toMatch(/^1[\s\u202f\u00a0]234,56 €$/);
  });

  it("rejette les valeurs non finies", () => {
    expect(() => formatMoneyEur(Number.NaN)).toThrow(TypeError);
    expect(() => formatMoneyEur(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("linesTotalCents", () => {
  it("additionne quantité × prix unitaire", () => {
    expect(
      linesTotalCents([
        { quantity: 2, unitPriceCents: 1990 },
        { quantity: 1, unitPriceCents: 590 },
      ]),
    ).toBe(4570);
  });
});
