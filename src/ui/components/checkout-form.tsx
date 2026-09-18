"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import {
  AddressForm,
  DEFAULT_ADDRESS,
  isAddressComplete,
  type AddressValue,
} from "@/ui/components/address-form";

export type CheckoutItem = {
  variantId: string;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
};

type ProviderName = "mock" | "mobile_money" | "bank_transfer" | "stripe";

type ProviderOption = {
  name: ProviderName;
  label: string;
  available: boolean;
  reason?: string;
};

type Method = "mock" | "mobile_money" | "bank_transfer";
type Operator = "ORANGE" | "MTN";

/**
 * Description de chaque méthode — elle vient de l'UI, pas du serveur : le
 * serveur dit ce qui est *utilisable*, pas comment l'expliquer au client.
 */
const PROVIDER_HINTS: Record<ProviderName, string> = {
  mock: "Mode test : aucun débit réel, la commande est validée immédiatement.",
  mobile_money:
    "Une demande de paiement est envoyée sur votre téléphone (Orange Money / MTN MoMo), vous la validez avec votre code.",
  bank_transfer:
    "Vous recevez l'IBAN et la référence à indiquer dans le libellé du virement. Validation à réception.",
  stripe: "Paiement par carte bancaire.",
};

/**
 * Repli si GET /api/payments/providers est injoignable : le mode simulé est
 * toujours disponible. On n'invente jamais la disponibilité des autres
 * méthodes — c'est le serveur qui sait.
 */
const FALLBACK_PROVIDERS: ProviderOption[] = [
  { name: "mock", label: "Paiement simulé (test)", available: true },
];

export function CheckoutForm(_props: { items?: CheckoutItem[] } = {}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(DEFAULT_ADDRESS);
  const [billingSame, setBillingSame] = useState(true);
  const [method, setMethod] = useState<Method>("mock");
  const [operator, setOperator] = useState<Operator>("ORANGE");
  const [providers, setProviders] = useState<ProviderOption[] | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les méthodes réellement utilisables sur cette instance viennent du
  // serveur (listAvailableProviders) : l'UI n'invente rien. Les indisponibles
  // sont affichées malgré tout, grisées, avec la raison renvoyée par le serveur.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/providers", { cache: "no-store" });
        const data = (await res.json()) as { providers?: ProviderOption[] };
        if (cancelled || !data.providers) return;
        setProviders(data.providers);
        const usable = data.providers.filter((p) => p.available && p.name !== "stripe");
        if (usable.length > 0 && !usable.some((p) => p.name === "mock")) {
          setMethod(usable[0]!.name as Method);
        }
      } catch {
        // Le serveur est la source de vérité : en cas d'échec réseau on garde
        // la méthode par défaut et la soumission remontera l'erreur réelle.
        if (!cancelled) setProviders(FALLBACK_PROVIDERS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAttempted(true);
    if (!isAddressComplete(address)) {
      setError("Adresse incomplète : complétez les champs signalés ci-dessous.");
      return;
    }
    if (method === "mobile_money" && !phone) {
      setError("Numéro de téléphone requis pour Mobile Money");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          phone,
          address: {
            line1: address.line1,
            line2: address.line2 || undefined,
            city: address.city,
            postalCode: address.postalCode,
            country: address.country.toUpperCase(),
          },
          billingAddressSame: billingSame,
          paymentMethod: method,
          ...(method === "mobile_money" ? { operator } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        orderId?: string;
        orderNumber?: string;
        redirectUrl?: string | null;
        error?: string;
      };
      if (!res.ok || !data.orderId) {
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      if (data.redirectUrl) {
        router.push(data.redirectUrl);
        return;
      }
      router.push(
        `/checkout/success?orderId=${data.orderId}&n=${encodeURIComponent(data.orderNumber ?? "")}`,
      );
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Erreur lors de la commande");
    } finally {
      setSubmitting(false);
    }
  }

  const options = providers ?? [];
  const loadingProviders = providers === null;

  const addressInvalid = attempted && !isAddressComplete(address);
  const phoneInvalid = attempted && method === "mobile_money" && phone.trim().length === 0;

  return (
    <form onSubmit={handleSubmit} className="card form">
      <h2 className="card__title">Vos informations</h2>

      <div className="form-grid">
        <label className="form-field">
          <span className="form-field__label">
            Email <span className="form-field__req">*</span>
          </span>
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          <p className="form-field__hint">La confirmation de commande y sera envoyée.</p>
        </label>

        <div className="form-grid form-grid--split">
          <label className="form-field">
            <span className="form-field__label">
              Prénom <span className="form-field__req">*</span>
            </span>
            <input
              name="firstName"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="form-field">
            <span className="form-field__label">
              Nom <span className="form-field__req">*</span>
            </span>
            <input
              name="lastName"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={submitting}
            />
          </label>
        </div>

        <label className={phoneInvalid ? "form-field form-field--invalid" : "form-field"}>
          <span className="form-field__label">
            Téléphone{" "}
            {method === "mobile_money" && <span className="form-field__req">*</span>}
          </span>
          <input
            type="tel"
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={submitting}
            required={method === "mobile_money"}
          />
          <p className="form-field__hint">
            {method === "mobile_money"
              ? "Requis : c'est le numéro qui recevra la demande de paiement."
              : "Facultatif — utile pour vous joindre au sujet de la livraison."}
          </p>
          {phoneInvalid && (
            <p className="form-field__error">Numéro de téléphone requis pour Mobile Money.</p>
          )}
        </label>
      </div>

      <h3 className="card__title">Adresse de livraison</h3>
      <AddressForm
        value={address}
        onChange={setAddress}
        disabled={submitting}
        invalid={addressInvalid}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={billingSame}
          onChange={(e) => setBillingSame(e.target.checked)}
          disabled={submitting}
        />
        Adresse de facturation identique à l&apos;adresse de livraison
      </label>

      <h3 className="card__title">Paiement</h3>

      {loadingProviders ? (
        <div className="pay-options" aria-busy="true" aria-live="polite">
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line skeleton-line--short" />
          <span className="skeleton skeleton-line" />
          <span className="sr-only">Chargement des moyens de paiement…</span>
        </div>
      ) : (
        <div className="pay-options">
          {options.map((p) => {
            const selectable = p.available;
            const active = method === p.name;
            const className = [
              "pay-option",
              active ? "pay-option--active" : "",
              selectable ? "" : "pay-option--disabled",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <label key={p.name} className={className}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value={p.name}
                  checked={active}
                  onChange={() => setMethod(p.name as Method)}
                  disabled={submitting || !selectable}
                />
                <span>
                  <span className="pay-option__name">{p.label}</span>
                  <span className="pay-option__desc">{PROVIDER_HINTS[p.name]}</span>
                  {!selectable && (
                    // Message CLIENT : la raison technique du provider
                    // (variables d'env, fichier à implémenter) n'a rien à faire
                    // dans l'interface d'achat. Elle reste disponible aux devs
                    // via l'attribut title et l'API /api/payments/providers.
                    <span className="pay-option__reason" title={p.reason ?? undefined}>
                      Indisponible pour le moment sur cette boutique.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {method === "mobile_money" && (
        <label className="form-field form-field--narrow">
          <span className="form-field__label">Opérateur</span>
          <select
            name="operator"
            value={operator}
            onChange={(e) => setOperator(e.target.value as Operator)}
            disabled={submitting}
          >
            <option value="ORANGE">Orange Money</option>
            <option value="MTN">MTN Mobile Money</option>
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="form-feedback form-feedback--error">
          {error}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? "Validation…" : "Payer et commander"}
        </button>
        <p className="note">
          Les champs marqués <span className="form-field__req">*</span> sont obligatoires.
        </p>
      </div>
    </form>
  );
}
