"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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

export function CheckoutForm(_props: { items?: CheckoutItem[] } = {}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(DEFAULT_ADDRESS);
  const [billingSame, setBillingSame] = useState(true);
  const [paymentMethod] = useState<"mock">("mock");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isAddressComplete(address)) {
      setError("Adresse incomplète");
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
          paymentMethod,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        orderId?: string;
        orderNumber?: string;
        error?: string;
      };
      if (!res.ok || !data.orderId) {
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }
      router.push(`/checkout/success?orderId=${data.orderId}&n=${encodeURIComponent(data.orderNumber ?? "")}`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Erreur lors de la commande");
    } finally {
      setSubmitting(false);
    }
  }

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
            Téléphone
            <input
              type="tel"
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
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
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#666" }}>
          Mode de paiement actif : <strong>Mock (test)</strong> — aucune carte n&apos;est débitée.
        </p>
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
