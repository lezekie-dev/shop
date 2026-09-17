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

type ProviderOption = {
  name: "mock" | "mobile_money" | "bank_transfer" | "stripe";
  label: string;
  available: boolean;
  reason?: string;
};

type Method = "mock" | "mobile_money" | "bank_transfer";
type Operator = "ORANGE" | "MTN";

const METHOD_HINTS: Record<Method, string> = {
  mock: "Mode test : aucun débit réel, la commande est validée immédiatement.",
  mobile_money:
    "Vous recevrez une demande de paiement sur votre téléphone (Orange Money / MTN MoMo).",
  bank_transfer:
    "Vous recevrez l'IBAN et la référence à indiquer. Validation à réception du virement.",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: "0.95rem",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.25rem",
  fontSize: "0.9rem",
  color: "#333",
};

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les méthodes réellement utilisables sur cette instance viennent du
  // serveur (listAvailableProviders) : l'UI n'invente rien.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/providers", { cache: "no-store" });
        const data = (await res.json()) as { providers?: ProviderOption[] };
        if (!cancelled && data.providers) {
          const usable = data.providers.filter((p) => p.available);
          setProviders(usable);
          if (usable.length > 0 && !usable.some((p) => p.name === "mock")) {
            setMethod(usable[0]!.name as Method);
          }
        }
      } catch {
        // Le serveur est la source de vérité : en cas d'échec réseau on garde
        // la méthode par défaut et la soumission remontera l'erreur réelle.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAddressComplete(address)) {
      setError("Adresse incomplète");
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

  const usableProviders = providers ?? [
    { name: "mock" as const, label: "Paiement simulé (test)", available: true },
  ];

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.5rem" }}>
      <fieldset style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <legend style={{ padding: "0 0.5rem", fontWeight: 600 }}>Vos coordonnées</legend>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <label style={labelStyle}>
            Email<span style={{ color: "#b00020" }}>*</span>
            <input
              type="email"
              name="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              style={inputStyle}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label style={labelStyle}>
              Prénom<span style={{ color: "#b00020" }}>*</span>
              <input
                name="firstName"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={submitting}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Nom<span style={{ color: "#b00020" }}>*</span>
              <input
                name="lastName"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={submitting}
                style={inputStyle}
              />
            </label>
          </div>
          <label style={labelStyle}>
            Téléphone{method === "mobile_money" && <span style={{ color: "#b00020" }}>*</span>}
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
              required={method === "mobile_money"}
              style={inputStyle}
            />
          </label>
        </div>
      </fieldset>

      <fieldset style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <legend style={{ padding: "0 0.5rem", fontWeight: 600 }}>Adresse de livraison</legend>
        <AddressForm value={address} onChange={setAddress} disabled={submitting} />
      </fieldset>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.9rem",
        }}
      >
        <input
          type="checkbox"
          checked={billingSame}
          onChange={(e) => setBillingSame(e.target.checked)}
          disabled={submitting}
        />
        Adresse de facturation identique à l&apos;adresse de livraison
      </label>

      <fieldset style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <legend style={{ padding: "0 0.5rem", fontWeight: 600 }}>Paiement</legend>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {usableProviders.map((p) => {
            const selectable = p.name !== "stripe";
            return (
              <label
                key={p.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "0.6rem",
                  alignItems: "start",
                  padding: "0.5rem",
                  border: method === p.name ? "1px solid #111" : "1px solid transparent",
                  borderRadius: 6,
                  cursor: selectable ? "pointer" : "not-allowed",
                }}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={p.name}
                  checked={method === p.name}
                  onChange={() => setMethod(p.name as Method)}
                  disabled={submitting || !selectable}
                />
                <span>
                  <strong style={{ display: "block" }}>{p.label}</strong>
                  <span style={{ color: "#666", fontSize: "0.85rem" }}>
                    {METHOD_HINTS[p.name as Method] ?? ""}
                  </span>
                </span>
              </label>
            );
          })}

          {method === "mobile_money" && (
            <label style={labelStyle}>
              Opérateur
              <select
                name="operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value as Operator)}
                disabled={submitting}
                style={inputStyle}
              >
                <option value="ORANGE">Orange Money</option>
                <option value="MTN">MTN Mobile Money</option>
              </select>
            </label>
          )}
        </div>
      </fieldset>

      {error && (
        <p role="alert" style={{ color: "#b00020", margin: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "0.85rem 1.25rem",
          background: submitting ? "#666" : "#111",
          color: "#fff",
          border: 0,
          borderRadius: 6,
          cursor: submitting ? "wait" : "pointer",
          fontWeight: 600,
          fontSize: "1rem",
        }}
      >
        {submitting ? "Validation…" : "Payer et commander"}
      </button>
    </form>
  );
}
