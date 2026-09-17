/**
 * Adaptateur « Virement bancaire » — `PaymentProvider` SANS aucune API externe.
 *
 * ─── POURQUOI CE PROVIDER ────────────────────────────────────────────
 * Le virement bancaire (SEPA / virement local) est un moyen de paiement réel
 * qui n'exige AUCUN compte marchand chez un PSP : le client vire l'argent sur
 * l'IBAN de la boutique, et un humain rapproche le virement dans l'admin.
 * C'est donc le moyen de paiement le plus « prêt à l'emploi » du MVP — il
 * fonctionne dès aujourd'hui, sans clé API.
 *
 * ─── CONTRAT ─────────────────────────────────────────────────────────
 * - `createIntent` : ne parle à personne. Renvoie une ref `bt_<cuid2>` et une
 *   URL de page d'instructions (IBAN + titulaire + banque + référence à
 *   indiquer dans le libellé du virement). Expire à +7 jours.
 * - `capture`      : TOUJOURS "pending". L'argent n'est pas encore arrivé :
 *   seul le marchand peut confirmer, via POST /api/admin/orders/[id]/mark-paid.
 * - `refund`       : "pending" — le marchand fait le virement retour à la main
 *   depuis sa banque. Aucun statut "succeeded" automatique n'est mensonger ici.
 * - `verifyWebhook`: jette. Un virement bancaire n'émet aucun webhook : il n'y
 *   a rien à vérifier, et prétendre le contraire serait un piège à bug.
 *
 * ─── CONFIGURATION ───────────────────────────────────────────────────
 * BANK_TRANSFER_IBAN / BANK_TRANSFER_HOLDER / BANK_TRANSFER_BANK_NAME.
 * Les défauts sont des VALEURS DE DÉMONSTRATION (IBAN de test, banque
 * fictive) : l'application démarre et se démontre sans aucune configuration.
 */

import { createId } from "@paralleldrive/cuid2";
import type {
  CaptureResult,
  CreateIntentInput,
  CreateIntentResult,
  Money,
  PaymentProvider,
  RefundResult,
  VerifiedWebhook,
  VerifyWebhookInput,
} from "@/domain/payment/provider";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Base des pages d'instructions virement. */
export const BANK_TRANSFER_INSTRUCTIONS_PATH = "/paiement/virement";

/** Valeurs de démonstration — permettent de tourner sans aucune config. */
export const BANK_TRANSFER_DEFAULTS = {
  iban: "FR76 3000 4000 0300 0000 0000 123",
  holder: "Shop Démo SARL",
  bankName: "Banque de Démonstration",
} as const;

export type BankTransferDetails = {
  iban: string;
  holder: string;
  bankName: string;
};

/** Lit l'IBAN / le titulaire / la banque depuis l'env, avec défauts démo. */
export function bankTransferDetails(): BankTransferDetails {
  return {
    iban: process.env.BANK_TRANSFER_IBAN ?? BANK_TRANSFER_DEFAULTS.iban,
    holder: process.env.BANK_TRANSFER_HOLDER ?? BANK_TRANSFER_DEFAULTS.holder,
    bankName: process.env.BANK_TRANSFER_BANK_NAME ?? BANK_TRANSFER_DEFAULTS.bankName,
  };
}

export class BankTransferPaymentProvider implements PaymentProvider {
  readonly name = "bank_transfer";

  constructor(private readonly details: BankTransferDetails = bankTransferDetails()) {}

  /** Détails bancaires à afficher au client (page d'instructions, email). */
  getDetails(): BankTransferDetails {
    return this.details;
  }

  async createIntent(_input: CreateIntentInput): Promise<CreateIntentResult> {
    const providerRef = `bt_${createId()}`;
    return {
      providerRef,
      redirectUrl: `${BANK_TRANSFER_INSTRUCTIONS_PATH}/${providerRef}`,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    };
  }

  async capture(providerRef: string): Promise<CaptureResult> {
    if (!providerRef) {
      throw new Error("BankTransferPaymentProvider.capture: providerRef vide");
    }
    // Le virement n'est jamais confirmé par le PSP — seulement par le marchand.
    return { status: "pending" };
  }

  async refund(providerRef: string, amount?: Money): Promise<RefundResult> {
    if (!providerRef) {
      throw new Error("BankTransferPaymentProvider.refund: providerRef vide");
    }
    if (amount && amount.amountCents <= 0) {
      throw new Error("BankTransferPaymentProvider.refund: amountCents doit être > 0");
    }
    // Virement retour exécuté manuellement par le marchand.
    return { refundRef: `btre_${createId()}`, status: "pending" };
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<VerifiedWebhook> {
    throw new Error(
      "BankTransferPaymentProvider.verifyWebhook: un virement bancaire n'émet aucun webhook — " +
        "la confirmation est manuelle (POST /api/admin/orders/[id]/mark-paid).",
    );
  }
}
