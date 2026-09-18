/**
 * Server layer — comptes clients et carnet d'adresses.
 *
 * Deux invariants portés par ce module :
 *
 *  1. Un client venu en INVITÉ existe déjà en base (`Customer` créé au
 *     checkout, `passwordHash` nul). « Créer un compte » sur cet email
 *     RATTACHE le compte à la ligne existante au lieu d'en insérer une
 *     nouvelle : la contrainte unique sur `email` l'interdirait de toute façon,
 *     mais surtout on perdrait l'historique de commandes du client, qui pointe
 *     sur `Order.customerId`.
 *
 *  2. Les messages d'erreur d'authentification sont GÉNÉRIQUES et identiques
 *     quel que soit le cas (email inconnu, pas de mot de passe, mauvais mot de
 *     passe). Un message plus précis transformerait le formulaire en oracle
 *     d'énumération de comptes.
 */

import type { Prisma } from "@prisma/client";

import { hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────────────

export type CustomerAccountErrorCode =
  | "REGISTRATION_REFUSED"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "ADDRESS_NOT_FOUND"
  | "ADDRESS_IN_USE";

export class CustomerAccountError extends Error {
  constructor(
    public readonly code: CustomerAccountErrorCode,
    message: string,
    /** Renseigné uniquement pour `RATE_LIMITED` (en-tête `Retry-After`). */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CustomerAccountError";
  }
}

/**
 * Message UNIQUE d'échec d'inscription.
 *
 * Il sert aussi bien à « un compte avec mot de passe existe déjà » qu'à toute
 * autre cause d'échec : le client qui a déjà un compte comprend quoi faire, et
 * un attaquant n'apprend pas si l'email est connu. Aucune variante, sinon le
 * texte lui-même devient le signal.
 */
export const REGISTRATION_REFUSED_MESSAGE =
  "Impossible de créer un compte avec ces informations. Si un compte existe déjà pour cet email, connectez-vous avec votre mot de passe.";

/** Message UNIQUE d'échec de connexion, quelle qu'en soit la raison. */
export const INVALID_CREDENTIALS_MESSAGE = "Email ou mot de passe incorrect.";

/**
 * Hash bidon comparé quand l'email est inconnu.
 *
 * Sans lui, une réponse « email inconnu » revient en quelques microsecondes et
 * une réponse « mauvais mot de passe » en ~100 ms (coût bcrypt) : le simple
 * chronomètre énumère les comptes existants. On paie donc un vrai
 * `bcrypt.compare` dans les deux cas.
 */
let decoyHash: string | null = null;

async function getDecoyHash(): Promise<string> {
  if (decoyHash === null) {
    decoyHash = await hashPassword("mot-de-passe-de-facade-jamais-utilise");
  }
  return decoyHash;
}

// ─────────────────────────────────────────────────────────────────────
// Inscription
// ─────────────────────────────────────────────────────────────────────

export type RegisterCustomerInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | undefined;
};

export type RegisterCustomerResult = {
  customerId: string;
  email: string;
  /** true = le compte a été greffé sur une ligne invité préexistante. */
  attachedToGuestAccount: boolean;
};

/**
 * Crée — ou réclame — le compte d'un client.
 *
 * Cas couverts :
 *  - email inconnu               → nouvelle ligne `Customer` avec mot de passe
 *  - email invité (hash nul)     → la ligne est complétée (rattachement)
 *  - email déjà pourvu d'un hash → refus, message générique, hash INTACT
 */
export async function registerCustomerAccount(
  input: RegisterCustomerInput,
): Promise<RegisterCustomerResult> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  const existing = await prisma.customer.findUnique({ where: { email } });

  if (existing && existing.passwordHash !== null) {
    // On ne touche à RIEN : écraser le mot de passe existant offrirait le
    // compte à quiconque connaît l'email. Le refus est volontairement
    // indiscernable d'une autre cause d'échec (cf. REGISTRATION_REFUSED_MESSAGE).
    throw new CustomerAccountError("REGISTRATION_REFUSED", REGISTRATION_REFUSED_MESSAGE);
  }

  if (existing) {
    // Rattachement : on garde l'identité saisie au checkout (c'est le nom qui
    // figure sur les commandes déjà passées) et on ne complète que les champs
    // manquants. On ajoute un téléphone s'il n'y en avait pas — la fiche reste
    // ainsi joignable pour la livraison des commandes en cours.
    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        firstName: existing.firstName ?? input.firstName,
        lastName: existing.lastName ?? input.lastName,
        phone: existing.phone ?? input.phone ?? null,
      },
    });
    return {
      customerId: updated.id,
      email: updated.email,
      attachedToGuestAccount: true,
    };
  }

  try {
    const created = await prisma.customer.create({
      data: {
        email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
      },
    });
    return { customerId: created.id, email: created.email, attachedToGuestAccount: false };
  } catch (err) {
    // P2002 : deux inscriptions simultanées sur le même email. On renvoie le
    // refus générique plutôt qu'une erreur 500 — le compte existe bel et bien.
    if (isUniqueConstraintViolation(err)) {
      throw new CustomerAccountError("REGISTRATION_REFUSED", REGISTRATION_REFUSED_MESSAGE);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Connexion
// ─────────────────────────────────────────────────────────────────────

export type AuthenticatedCustomer = {
  customerId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

/**
 * Vérifie un couple email / mot de passe.
 *
 * Le plafonnement des tentatives est appliqué par l'appelant (route) AVANT
 * l'appel, car le coût bcrypt ne doit pas être payé pour un essai déjà refusé ;
 * `lastLoginAt` est en revanche mis à jour ici, au seul moment où l'on sait que
 * l'authentification est réussie.
 */
export async function verifyCustomerCredentials(input: {
  email: string;
  password: string;
}): Promise<AuthenticatedCustomer> {
  const email = normalizeEmail(input.email);
  const customer = await prisma.customer.findUnique({ where: { email } });

  if (!customer || customer.passwordHash === null) {
    // Un invité (hash nul) n'a pas de mot de passe à comparer : même traitement
    // qu'un email inconnu, message et temps de réponse compris.
    await verifyPassword(input.password, await getDecoyHash());
    throw new CustomerAccountError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  }

  const ok = await verifyPassword(input.password, customer.passwordHash);
  if (!ok) {
    throw new CustomerAccountError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  }

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    customerId: updated.id,
    email: updated.email,
    firstName: updated.firstName,
    lastName: updated.lastName,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Carnet d'adresses
// ─────────────────────────────────────────────────────────────────────

export type CustomerAddress = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
  /** Nombre de commandes qui référencent cette adresse — bloque la suppression. */
  usageCount: number;
};

export type AddressInput = {
  label?: string | undefined;
  line1: string;
  line2?: string | undefined;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | undefined;
  isDefault?: boolean | undefined;
};

/**
 * Adresses du client connecté, la plus récente d'abord, défaut en tête.
 *
 * `_count.orders` et `_count.billingOrders` comptent les DEUX relations nommées
 * qui relient `Address` à `Order` (`OrderShipping` et `OrderBilling`) : une
 * adresse de facturation utilisée par une commande ne doit pas pouvoir être
 * supprimée, et n'interroger que `orders` laisserait passer ce cas.
 */
export async function listCustomerAddresses(customerId: string): Promise<CustomerAddress[]> {
  const rows = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { id: "desc" }],
    include: { _count: { select: { orders: true, billingOrders: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    isDefault: row.isDefault,
    usageCount: row._count.orders + row._count.billingOrders,
  }));
}

/**
 * Ajoute une adresse au carnet.
 *
 * La PREMIÈRE adresse d'un client devient automatiquement l'adresse par défaut :
 * un carnet sans défaut oblige le prochain checkout à redemander une adresse
 * alors qu'il en existe une.
 */
export async function createCustomerAddress(
  customerId: string,
  input: AddressInput,
): Promise<CustomerAddress> {
  return prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { customerId } });
    const shouldBeDefault = input.isDefault === true || count === 0;

    if (shouldBeDefault) await clearDefaultFlag(tx, customerId);

    const created = await tx.address.create({
      data: {
        customerId,
        label: input.label ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country.toUpperCase(),
        phone: input.phone ?? null,
        isDefault: shouldBeDefault,
      },
    });

    return { ...toAddressDto(created), usageCount: 0 };
  });
}

/**
 * Met à jour une adresse DU CLIENT.
 *
 * La condition `customerId` est dans le `where` : une adresse appartenant à
 * quelqu'un d'autre est introuvable, pas « interdite » — on ne confirme pas
 * son existence.
 */
export async function updateCustomerAddress(
  customerId: string,
  addressId: string,
  input: AddressInput,
): Promise<CustomerAddress> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id: addressId, customerId } });
    if (!existing) {
      throw new CustomerAccountError("ADDRESS_NOT_FOUND", "Adresse introuvable.");
    }

    if (input.isDefault === true) await clearDefaultFlag(tx, customerId);

    const updated = await tx.address.update({
      where: { id: existing.id },
      data: {
        label: input.label ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country.toUpperCase(),
        phone: input.phone ?? null,
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      },
      include: { _count: { select: { orders: true, billingOrders: true } } },
    });

    return {
      ...toAddressDto(updated),
      usageCount: updated._count.orders + updated._count.billingOrders,
    };
  });
}

/** Fait de cette adresse l'adresse par défaut (une seule par client). */
export async function setDefaultCustomerAddress(
  customerId: string,
  addressId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({ where: { id: addressId, customerId } });
    if (!existing) {
      throw new CustomerAccountError("ADDRESS_NOT_FOUND", "Adresse introuvable.");
    }
    await clearDefaultFlag(tx, customerId);
    await tx.address.update({ where: { id: existing.id }, data: { isDefault: true } });
  });
}

/**
 * Supprime une adresse du carnet.
 *
 * Refusé si une commande la référence : les commandes passées sont des pièces
 * comptables, leur adresse de livraison doit rester lisible. La clé étrangère
 * `Order.addressId` est en `Restrict` — sans ce contrôle, l'utilisateur
 * recevrait une erreur 500 opaque au lieu d'une explication.
 */
export async function deleteCustomerAddress(
  customerId: string,
  addressId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({
      where: { id: addressId, customerId },
      include: { _count: { select: { orders: true, billingOrders: true } } },
    });
    if (!existing) {
      throw new CustomerAccountError("ADDRESS_NOT_FOUND", "Adresse introuvable.");
    }
    const usage = existing._count.orders + existing._count.billingOrders;
    if (usage > 0) {
      throw new CustomerAccountError(
        "ADDRESS_IN_USE",
        `Cette adresse est rattachée à ${usage} commande${usage > 1 ? "s" : ""} : elle ne peut pas être supprimée, seulement modifiée.`,
      );
    }
    await tx.address.delete({ where: { id: existing.id } });

    // Le carnet ne doit pas se retrouver sans adresse par défaut après la
    // suppression de celle qui la portait.
    if (existing.isDefault) {
      const next = await tx.address.findFirst({
        where: { customerId },
        orderBy: { id: "desc" },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function clearDefaultFlag(tx: Prisma.TransactionClient, customerId: string): Promise<void> {
  await tx.address.updateMany({
    where: { customerId, isDefault: true },
    data: { isDefault: false },
  });
}

function toAddressDto(row: {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}): Omit<CustomerAddress, "usageCount"> {
  return {
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    isDefault: row.isDefault,
  };
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Traduit une erreur métier du carnet d'adresses en statut HTTP
 * (cf. CONVENTIONS §6 : la route ne décide pas, elle mappe).
 */
export function customerAccountErrorStatus(error: CustomerAccountError): number {
  switch (error.code) {
    case "ADDRESS_NOT_FOUND":
      // 404 et non 403 : une adresse d'un autre client est « introuvable »,
      // sinon on confirme son existence à qui énumère des ids.
      return 404;
    case "ADDRESS_IN_USE":
      // Conflit : la demande est valide, l'état de la base l'empêche.
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "REGISTRATION_REFUSED":
      return 409;
    case "INVALID_CREDENTIALS":
      return 401;
  }
}
