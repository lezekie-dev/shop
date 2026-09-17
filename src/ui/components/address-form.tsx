"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

export type AddressValue = {
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
};

export const DEFAULT_ADDRESS: AddressValue = {
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  country: "FR",
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

/**
 * Formulaire d'adresse (livraison ou facturation). Controlled.
 * Le parent fournit la valeur + onChange.
 */
export function AddressForm({
  value,
  onChange,
  disabled,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
}) {
  function handle<K extends keyof AddressValue>(key: K) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, [key]: e.target.value });
    };
  }
  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <label style={labelStyle}>
        Adresse<span style={{ color: "#b00020" }}>*</span>
        <input
          name="line1"
          required
          value={value.line1}
          onChange={handle("line1")}
          disabled={disabled}
          placeholder="12 rue des Lilas"
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Complément
        <input
          name="line2"
          value={value.line2}
          onChange={handle("line2")}
          disabled={disabled}
          placeholder="Bâtiment, étage, digicode…"
          style={inputStyle}
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
        <label style={labelStyle}>
          Ville<span style={{ color: "#b00020" }}>*</span>
          <input
            name="city"
            required
            value={value.city}
            onChange={handle("city")}
            disabled={disabled}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Code postal<span style={{ color: "#b00020" }}>*</span>
          <input
            name="postalCode"
            required
            value={value.postalCode}
            onChange={handle("postalCode")}
            disabled={disabled}
            style={inputStyle}
          />
        </label>
      </div>
      <label style={labelStyle}>
        Pays<span style={{ color: "#b00020" }}>*</span>
        <input
          name="country"
          required
          maxLength={2}
          minLength={2}
          value={value.country}
          onChange={handle("country")}
          disabled={disabled}
          placeholder="FR"
          style={inputStyle}
        />
      </label>
    </div>
  );
}

// Helper pour form -> value (pour les pages server qui pré-rendent le form)
export function collectAddress(form: FormData): AddressValue {
  return {
    line1: String(form.get("line1") ?? "").trim(),
    line2: String(form.get("line2") ?? "").trim(),
    city: String(form.get("city") ?? "").trim(),
    postalCode: String(form.get("postalCode") ?? "").trim(),
    country: String(form.get("country") ?? "FR").trim().toUpperCase(),
  };
}

export function isAddressComplete(a: AddressValue): boolean {
  return a.line1.length > 0 && a.city.length > 0 && a.postalCode.length > 0 && a.country.length === 2;
}

// Pour avoir une signature cohérente avec les forms server, expose un type
export type AddressFormProps = {
  defaultValue?: AddressValue;
  onSubmit?: (a: AddressValue) => void;
};
