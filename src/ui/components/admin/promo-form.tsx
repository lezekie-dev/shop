"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PROMO_MAX_PERCENT, parseMinorUnitsInput } from "@/domain/promo";

/**
 * Création d'un code promo (POST /api/admin/promos).
 *
 * ─── POURQUOI LE FORMULAIRE PARLE EN EUROS ET L'API EN CENTIMES ─────────
 * Fatou saisit « 5 » ou « 12,50 ». La conversion vers l'entier stocké passe par
 * `parseMinorUnitsInput` (domaine), qui découpe la partie décimale à la main —
 * jamais `Number(saisie) * 100`, la multiplication flottante que les
 * CONVENTIONS §5 interdisent. L'API, elle, ne reçoit que des entiers : le
 * contrat HTTP ne peut donc pas être ambigu sur les décimales.
 *
 * ─── POURQUOI « ACTIF » EST DÉCOCHÉ PAR DÉFAUT ─────────────────────────
 * AC E1 : « un code créé est inactif par défaut ; l'activation est un geste
 * explicite ». Un code qui part en campagne par oubli de case à cocher est une
 * remise accordée sans que personne l'ait décidée.
 *
 * ─── POURQUOI LE CHAMP DATE EST EN `datetime-local` ────────────────────
 * Il rend une date LOCALE sans fuseau (« 2026-09-21T14:30 »). Le navigateur la
 * convertit en ISO 8601 (UTC) avant l'envoi : le serveur ne stocke jamais une
 * heure locale ambiguë, et une campagne qui démarre à minuit à Douala démarre
 * bien à minuit sur place.
 */
export function PromoCreateForm() {
  const router = useRouter();
  const [kind, setKind] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const code = String(data.get("code") ?? "").trim();
    const rawValue = String(data.get("value") ?? "").trim();
    const rawMinSubtotal = String(data.get("minSubtotal") ?? "").trim();

    // Le pourcentage est un ENTIER de points, pas un montant : il ne passe pas
    // par le parseur de minor units. Deux natures de « valeur », un seul champ
    // à l'écran — d'où le libellé qui change avec le type de remise.
    let value: number | null;
    if (kind === "PERCENT") {
      value = /^\d+$/.test(rawValue) ? Number.parseInt(rawValue, 10) : null;
      if (value !== null && value > PROMO_MAX_PERCENT) value = null;
    } else {
      value = rawValue.length > 0 ? parseMinorUnitsInput(rawValue) : null;
    }
    if (value === null || value <= 0) {
      setError(
        kind === "PERCENT"
          ? `Saisissez un pourcentage entier entre 1 et ${PROMO_MAX_PERCENT}.`
          : "Saisissez un montant de remise valide (ex. 5 ou 12,50).",
      );
      return;
    }

    const minSubtotalCents = rawMinSubtotal.length > 0 ? parseMinorUnitsInput(rawMinSubtotal) : 0;
    if (minSubtotalCents === null) {
      setError("Le minimum d'achat n'est pas un montant valide (ex. 50 ou 49,90).");
      return;
    }

    const startsAt = toIsoOrNull(String(data.get("startsAt") ?? ""));
    const endsAt = toIsoOrNull(String(data.get("endsAt") ?? ""));
    const maxRedemptions = toPositiveIntOrNull(String(data.get("maxRedemptions") ?? ""));
    const maxPerCustomer = toPositiveIntOrNull(String(data.get("maxPerCustomer") ?? ""));
    if (maxRedemptions === "invalid" || maxPerCustomer === "invalid") {
      setError("Les plafonds d'utilisation doivent être des nombres entiers positifs, ou vides.");
      return;
    }

    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          kind,
          value,
          minSubtotalCents,
          startsAt,
          endsAt,
          maxRedemptions,
          maxPerCustomer,
          active,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `Échec de la création (HTTP ${res.status}).`);
        return;
      }
      form.reset();
      setKind("PERCENT");
      setActive(false);
      setCreated(
        active
          ? `Code ${code.toUpperCase()} créé et ACTIF : il est utilisable immédiatement.`
          : `Code ${code.toUpperCase()} créé, encore INACTIF. Activez-le quand la campagne démarre.`,
      );
      router.refresh();
    } catch {
      setError("Erreur réseau : le code n'a pas été créé.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form-grid">
      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Code</span>
          <input
            name="code"
            required
            minLength={3}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            style={{ textTransform: "uppercase" }}
            placeholder="BIENVENUE"
          />
          <span className="form-field__hint">
            3 à 24 caractères : lettres, chiffres et tirets. Toujours enregistré en MAJUSCULES, donc
            « bienvenue » et « BIENVENUE » désignent le même code.
          </span>
        </label>

        <label className="form-field">
          <span className="form-field__label">Type de remise</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value === "FIXED" ? "FIXED" : "PERCENT")}
          >
            <option value="PERCENT">Pourcentage du sous-total</option>
            <option value="FIXED">Montant fixe</option>
          </select>
        </label>
      </div>

      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">
            {kind === "PERCENT" ? "Pourcentage (%)" : "Montant de la remise (€)"}
          </span>
          <input name="value" required inputMode="decimal" placeholder={kind === "PERCENT" ? "10" : "5"} />
          <span className="form-field__hint">
            {kind === "PERCENT"
              ? `Entier de 1 à ${PROMO_MAX_PERCENT}. La remise ne peut jamais dépasser le sous-total.`
              : "La remise est plafonnée au sous-total : un code de 50 € sur un panier de 10 € ne retire que 10 €."}
          </span>
        </label>

        <label className="form-field">
          <span className="form-field__label">Minimum d&apos;achat (€)</span>
          <input name="minSubtotal" inputMode="decimal" placeholder="0" />
          <span className="form-field__hint">
            Sous-total minimum pour que le code s&apos;applique. 0 = aucun minimum. La livraison
            n&apos;entre pas dans ce minimum.
          </span>
        </label>
      </div>

      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Début de validité</span>
          <input type="datetime-local" name="startsAt" />
          <span className="form-field__hint">Vide = utilisable tout de suite (une fois activé).</span>
        </label>
        <label className="form-field">
          <span className="form-field__label">Fin de validité</span>
          <input type="datetime-local" name="endsAt" />
          <span className="form-field__hint">
            Vide = sans fin. Un code actif sans date de fin est signalé dans la liste.
          </span>
        </label>
      </div>

      <div className="form-grid form-grid--2">
        <label className="form-field">
          <span className="form-field__label">Plafond total d&apos;utilisations</span>
          <input name="maxRedemptions" inputMode="numeric" placeholder="Illimité" />
          <span className="form-field__hint">
            Nombre maximum de commandes pouvant profiter du code. Vide = illimité.
          </span>
        </label>
        <label className="form-field">
          <span className="form-field__label">Plafond par client</span>
          <input name="maxPerCustomer" inputMode="numeric" placeholder="Illimité" />
          <span className="form-field__hint">
            Nombre d&apos;utilisations par client, identifié par son email de commande. Vide =
            illimité.
          </span>
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Activer ce code dès sa création
      </label>
      <p className="form-field__hint" style={{ margin: 0 }}>
        Laisser décoché est le réglage par défaut : un code inactif n&apos;est pas utilisable, donc
        une campagne ne peut pas démarrer par inadvertance. L&apos;activation se fait d&apos;un clic
        dans la liste.
      </p>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Création…" : "Créer le code"}
        </button>
      </div>

      {created ? (
        <p className="form-feedback form-feedback--ok" role="status">
          {created}
        </p>
      ) : null}
      {error ? (
        <p className="form-feedback form-feedback--error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** « 2026-09-21T14:30 » (heure locale) → ISO 8601 UTC, ou `null` si vide. */
function toIsoOrNull(raw: string): string | null {
  if (raw.trim().length === 0) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Entier positif, `null` si vide, ou la chaîne « invalid » si non exploitable. */
function toPositiveIntOrNull(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number.parseInt(trimmed, 10);
  return value > 0 ? value : "invalid";
}
