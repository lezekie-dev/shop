"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

import type { CustomerAddress } from "@/server/customer-account";

/**
 * Carnet d'adresses du client : création, édition, suppression, choix du défaut.
 *
 * Le composant travaille par appels HTTP (`/api/account/addresses`) plutôt que
 * par Server Actions : l'API est la même que celle utilisée par les tests, et
 * l'autorisation y est vérifiée une seule fois (par le `customerId` de session)
 * au lieu d'être répartie entre actions serveur et routes.
 *
 * Règle d'ergonomie : une adresse rattachée à une commande ne peut PAS être
 * supprimée (le serveur répond 409). Le bouton reste affiché mais désactivé
 * avec l'explication, pour que le refus ne soit pas une surprise au clic.
 */

type AddressDraft = {
  label: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
};

const EMPTY_DRAFT: AddressDraft = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  country: "FR",
  phone: "",
  isDefault: false,
};

function draftFrom(address: CustomerAddress): AddressDraft {
  return {
    label: address.label ?? "",
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone ?? "",
    isDefault: address.isDefault,
  };
}

/** Corps d'API : les champs vides sont omis (un `label: ""` créerait un libellé vide affiché). */
function toPayload(draft: AddressDraft): Record<string, unknown> {
  return {
    line1: draft.line1.trim(),
    line2: draft.line2.trim() || undefined,
    city: draft.city.trim(),
    postalCode: draft.postalCode.trim(),
    country: draft.country.trim().toUpperCase(),
    label: draft.label.trim() || undefined,
    phone: draft.phone.trim() || undefined,
    isDefault: draft.isDefault,
  };
}

export function AddressBook({ initialAddresses }: { initialAddresses: CustomerAddress[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState<CustomerAddress[]>(initialAddresses);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(initialAddresses.length === 0);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function field<K extends keyof AddressDraft>(key: K) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value =
        key === "isDefault" ? event.target.checked : event.target.value;
      setDraft((current) => ({ ...current, [key]: value }));
    };
  }

  function openCreate() {
    setEditingId(null);
    setCreating(true);
    setDraft({ ...EMPTY_DRAFT, isDefault: addresses.length === 0 });
    setError(null);
  }

  function openEdit(address: CustomerAddress) {
    setCreating(false);
    setEditingId(address.id);
    setDraft(draftFrom(address));
    setError(null);
  }

  function closeForm() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload = toPayload(draft);
    const editing = editingId !== null;
    try {
      const res = await fetch(
        editing ? `/api/account/addresses/${editingId}` : "/api/account/addresses",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Enregistrement impossible.");
        setBusy(false);
        return;
      }

      const data = (await res.json()) as { address: CustomerAddress };
      setAddresses((current) => mergeAddress(current, data.address));
      closeForm();
      setBusy(false);
      // Le reste du site (en-tête, checkout) lit les adresses côté serveur :
      // on force un re-rendu pour qu'il ne travaille pas sur l'ancien carnet.
      router.refresh();
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setBusy(false);
    }
  }

  async function makeDefault(address: CustomerAddress) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/addresses/${address.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Changement impossible.");
        setBusy(false);
        return;
      }
      setAddresses((current) =>
        current.map((a) => ({ ...a, isDefault: a.id === address.id })),
      );
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setBusy(false);
    }
  }

  async function remove(address: CustomerAddress) {
    // Double confirmation : la suppression est définitive et le client ne peut
    // pas la reconstituer de mémoire (numéro, complément, code postal).
    const confirmed = window.confirm(
      `Supprimer l'adresse « ${address.label ?? address.line1} » ? Cette action est définitive.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/addresses/${address.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Suppression impossible.");
        setBusy(false);
        return;
      }
      const wasDefault = address.isDefault;
      setAddresses((current) => {
        const remaining = current.filter((a) => a.id !== address.id);
        // Le serveur promeut une autre adresse quand on supprime celle par
        // défaut ; l'état local doit suivre sans rechargement.
        if (!wasDefault || remaining.length === 0) return remaining;
        const [first, ...rest] = remaining;
        return first ? [{ ...first, isDefault: true }, ...rest] : remaining;
      });
      setBusy(false);
      router.refresh();
    } catch {
      setError("Erreur réseau — vérifiez votre connexion.");
      setBusy(false);
    }
  }

  const formVisible = creating || editingId !== null;

  return (
    <div className="section">
      {error && (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      )}

      {addresses.length === 0 && !formVisible && (
        <div className="empty-state">
          <p className="empty-state__title">Aucune adresse enregistrée</p>
          <p className="empty-state__text">
            Enregistrez une adresse ici pour la retrouver au moment de payer.
          </p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              Ajouter une adresse
            </button>
          </div>
        </div>
      )}

      {addresses.length > 0 && (
        <ul className="line-list">
          {addresses.map((address) => (
            <li key={address.id} className="line line--stacked">
              <div className="line__body">
                <p className="line__article">
                  {address.label ?? `${address.line1} ${address.city}`}
                  {address.isDefault && <span className="badge badge-paid">Par défaut</span>}
                </p>
                <p className="line__meta">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                  <br />
                  {address.postalCode} {address.city} — {address.country}
                  {address.phone ? (
                    <>
                      <br />
                      <span className="num">{address.phone}</span>
                    </>
                  ) : null}
                </p>
                {address.usageCount > 0 && (
                  <p className="line__meta small muted">
                    Utilisée par {address.usageCount} commande
                    {address.usageCount > 1 ? "s" : ""} — modifiable, non supprimable.
                  </p>
                )}
                <div className="line__foot actions">
                  {!address.isDefault && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => makeDefault(address)}
                      disabled={busy}
                    >
                      Définir par défaut
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => openEdit(address)}
                    disabled={busy}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => remove(address)}
                    disabled={busy || address.usageCount > 0}
                    title={
                      address.usageCount > 0
                        ? "Adresse citée par une commande : conservez-la pour l'historique."
                        : undefined
                    }
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!formVisible ? (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={openCreate} disabled={busy}>
            Ajouter une adresse
          </button>
        </div>
      ) : (
        <form className="form card" onSubmit={submit}>
          <h2 className="card__title">
            {editingId !== null ? "Modifier l'adresse" : "Nouvelle adresse"}
          </h2>

          <label className="form-field">
            <span className="form-field__label">Libellé</span>
            <input
              type="text"
              name="label"
              value={draft.label}
              onChange={field("label")}
              maxLength={40}
              placeholder="Domicile, Bureau…"
            />
          </label>

          <div className="form-grid">
            <label className="form-field">
              <span className="form-field__label">
                Adresse <span className="form-field__req">*</span>
              </span>
              <input
                type="text"
                name="line1"
                required
                value={draft.line1}
                onChange={field("line1")}
                maxLength={200}
                placeholder="12 rue des Lilas"
              />
            </label>

            <label className="form-field">
              <span className="form-field__label">Complément</span>
              <input
                type="text"
                name="line2"
                value={draft.line2}
                onChange={field("line2")}
                maxLength={200}
                placeholder="Bâtiment, étage, digicode…"
              />
            </label>

            <div className="form-grid form-grid--city">
              <label className="form-field">
                <span className="form-field__label">
                  Ville <span className="form-field__req">*</span>
                </span>
                <input
                  type="text"
                  name="city"
                  required
                  value={draft.city}
                  onChange={field("city")}
                  maxLength={120}
                />
              </label>

              <label className="form-field">
                <span className="form-field__label">
                  Code postal <span className="form-field__req">*</span>
                </span>
                <input
                  type="text"
                  name="postalCode"
                  required
                  value={draft.postalCode}
                  onChange={field("postalCode")}
                  maxLength={20}
                />
              </label>
            </div>

            <div className="form-grid form-grid--2">
              <label className="form-field">
                <span className="form-field__label">
                  Pays <span className="form-field__req">*</span>
                </span>
                <input
                  type="text"
                  name="country"
                  required
                  minLength={2}
                  maxLength={2}
                  value={draft.country}
                  onChange={field("country")}
                />
                <p className="form-field__hint">Code à deux lettres (FR, BE, CM…).</p>
              </label>

              <label className="form-field">
                <span className="form-field__label">Téléphone</span>
                <input
                  type="tel"
                  name="phone"
                  value={draft.phone}
                  onChange={field("phone")}
                  maxLength={40}
                />
              </label>
            </div>

            <label className="form-field form-field--narrow">
              <span className="form-field__label">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  onChange={field("isDefault")}
                />{" "}
                Utiliser comme adresse par défaut
              </span>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Insère ou remplace une adresse dans la liste locale, en retirant le drapeau
 * « par défaut » des autres quand la nouvelle le porte (le serveur applique la
 * même règle en base : une seule adresse par défaut par client).
 */
function mergeAddress(current: CustomerAddress[], next: CustomerAddress): CustomerAddress[] {
  const withoutNext = current.filter((a) => a.id !== next.id);
  const withFlags = next.isDefault
    ? withoutNext.map((a) => ({ ...a, isDefault: false }))
    : withoutNext;
  const merged = [...withFlags, next];
  return merged.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
