import { describe, expect, it } from "vitest";

import {
  allCapabilities,
  can,
  canAll,
  canAny,
  CAPABILITIES,
  capabilitiesFor,
  roleLabel,
  type Capability,
} from "@/domain/access";

/**
 * Matrice de capacités (CONVENTIONS §13) — TypeScript pur, aucune DB, aucun mock.
 *
 * Ces tests sont la doublure de la documentation : si quelqu'un élargit les
 * droits de STAFF sans modifier §13 des CONVENTIONS, c'est ici que ça se voit.
 * Ils figent les deux invariants qui protègent la boutique :
 *   - STAFF ne touche pas au catalogue, aux utilisateurs ni à l'argent ;
 *   - STAFF fait tourner l'exploitation quotidienne (commandes, expéditions).
 */

const STAFF_FORBIDDEN: Capability[] = [
  "products:read",
  "products:write",
  "categories:write",
  "orders:refund",
  "orders:transition:paid",
  "orders:transition:cancelled",
  "customers:write",
  "users:read",
  "users:write",
  "settings:write",
  "audit-log:read",
];

describe("matrice de capacités", () => {
  it("ADMIN porte toutes les capacités déclarées", () => {
    for (const capability of allCapabilities()) {
      expect(can("ADMIN", capability)).toBe(true);
    }
  });

  it("STAFF ne porte AUCUNE capacité réservée à l'administration", () => {
    for (const capability of STAFF_FORBIDDEN) {
      expect(can("STAFF", capability)).toBe(false);
    }
  });

  it("STAFF porte les capacités d'exploitation quotidienne", () => {
    for (const capability of [
      "auth:login",
      "dashboard:view",
      "orders:read",
      "orders:transition:preparing",
      "orders:transition:shipped",
      "orders:transition:delivered",
      "customers:read",
    ] satisfies Capability[]) {
      expect(can("STAFF", capability)).toBe(true);
    }
  });

  it("chaque capacité listée au catalogue existe dans au moins une matrice", () => {
    for (const role of ["ADMIN", "STAFF"] as const) {
      for (const capability of capabilitiesFor(role)) {
        expect(CAPABILITIES.ADMIN).toContain(capability);
      }
    }
  });

  it("canAll exige tout, canAny se contente d'un seul", () => {
    expect(canAll("STAFF", ["orders:read", "orders:transition:shipped"])).toBe(true);
    expect(canAll("STAFF", ["orders:read", "users:write"])).toBe(false);
    expect(canAny("STAFF", ["users:write", "orders:read"])).toBe(true);
    expect(canAny("STAFF", ["users:write", "settings:write"])).toBe(false);
  });

  it("un tableau de capacités vide est « autorisé » par canAll (identité logique)", () => {
    // Aucune garde n'est appelée sans capacité ; on documente le cas limite
    // pour qu'il ne soit pas découvert par surprise dans une route.
    expect(canAll("STAFF", [])).toBe(true);
  });

  it("nomme les rôles en français pour l'en-tête du back-office", () => {
    expect(roleLabel("ADMIN")).toBe("Administrateur");
    expect(roleLabel("STAFF")).toBe("Opérateur");
  });
});
