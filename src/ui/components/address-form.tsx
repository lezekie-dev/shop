"use client";

import { useState, type ChangeEvent } from "react";

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

/**
 * Formulaire d'adresse (livraison ou facturation). Controlled.
 * Le parent fournit la valeur + onChange, et signale `invalid` après une
 * tentative d'envoi ratée : les champs concernés passent alors en état d'erreur
 * visuel (bordure + fond `--danger-tint`), accompagnés d'un texte explicatif.
 */
export function AddressForm({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  function handle<K extends keyof AddressValue>(key: K) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      onChange({ ...value, [key]: e.target.value });
    };
  }

  const fieldClass = (bad?: boolean) =>
    `form-field${bad ? " form-field--invalid" : ""}`;

  return (
    <div className="form-grid">
      <label className={fieldClass(invalid && value.line1.trim().length === 0)}>
        <span className="form-field__label">
          Adresse <span className="form-field__req">*</span>
        </span>
        <input
          name="line1"
          required
          value={value.line1}
          onChange={handle("line1")}
          disabled={disabled}
          placeholder="12 rue des Lilas"
        />
        {invalid && value.line1.trim().length === 0 && (
          <p className="form-field__error">Indiquez le numéro et le nom de la rue.</p>
        )}
      </label>

      <label className="form-field">
        <span className="form-field__label">Complément</span>
        <input
          name="line2"
          value={value.line2}
          onChange={handle("line2")}
          disabled={disabled}
          placeholder="Bâtiment, étage, digicode…"
        />
        <p className="form-field__hint">Facultatif : utile pour les livraisons en immeuble.</p>
      </label>

      <div className="form-grid form-grid--city">
        <label className={fieldClass(invalid && value.city.trim().length === 0)}>
          <span className="form-field__label">
            Ville <span className="form-field__req">*</span>
          </span>
          <input
            name="city"
            required
            value={value.city}
            onChange={handle("city")}
            disabled={disabled}
          />
          {invalid && value.city.trim().length === 0 && (
            <p className="form-field__error">Indiquez la ville de livraison.</p>
          )}
        </label>

        <label className={fieldClass(invalid && value.postalCode.trim().length === 0)}>
          <span className="form-field__label">
            Code postal <span className="form-field__req">*</span>
          </span>
          <input
            name="postalCode"
            required
            value={value.postalCode}
            onChange={handle("postalCode")}
            disabled={disabled}
          />
          {invalid && value.postalCode.trim().length === 0 && (
            <p className="form-field__error">Code postal requis.</p>
          )}
        </label>
      </div>

      <label className={fieldClass(invalid && value.country.trim().length !== 2)}>
        <span className="form-field__label">
          Pays <span className="form-field__req">*</span>
        </span>
        <input
          name="country"
          required
          maxLength={2}
          minLength={2}
          value={value.country}
          onChange={handle("country")}
          disabled={disabled}
          placeholder="FR"
        />
        <p className="form-field__hint">Code à deux lettres (FR, BE, CH…).</p>
        {invalid && value.country.trim().length !== 2 && (
          <p className="form-field__error">Le pays doit être un code à deux lettres.</p>
        )}
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
  invalid?: boolean;
  onSubmit?: (a: AddressValue) => void;
};
