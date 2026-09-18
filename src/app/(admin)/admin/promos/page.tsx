import Link from "next/link";

import { describePromoRule, promoStatusLabel, type PromoStatus } from "@/domain/promo";
import { formatMoneyEur } from "@/domain/pricing";
import { staffCan, requireCapability } from "@/server/guards";
import { listPromoCodes, type AdminPromoRow } from "@/server/promo";
import { DataTable } from "@/ui/components/admin/data-table";
import { PromoActions } from "@/ui/components/admin/promo-actions";
import { PromoCreateForm } from "@/ui/components/admin/promo-form";
import { IconEuro } from "@/ui/components/icons";
import { formatDateTime } from "@/ui/format";

export const dynamic = "force-dynamic";

/**
 * Gestion des codes promo (chantier E) — capacité `promos:read`.
 *
 * ─── POURQUOI CETTE LISTE AFFICHE LE COÛT, PAS SEULEMENT L'USAGE ───────
 * Le PO est catégorique (AC E1) : « Fatou doit voir ce que le code lui coûte,
 * pas seulement combien de fois il a servi ». Un code utilisé 40 fois peut
 * cacher 40 € comme 400 € de marge offerte ; le coût cumulé
 * (`PromoRedemption.amountCents`) est ce qui transforme la liste en outil de
 * pilotage et qui alimente le KPI K6.
 *
 * ─── POURQUOI LE STATUT EST DÉDUIT, PAS STOCKÉ ──────────────────────────
 * « Expiré » et « épuisé » ne sont pas des champs : ils se calculent à
 * l'instant du rendu, à partir de l'activité, des dates et des compteurs. Un
 * statut stocké serait faux dès le lendemain d'une campagne — et une liste qui
 * ment est pire qu'une liste absente.
 *
 * Garde posée ici ET sur les routes API : masquer un lien n'est pas une
 * protection (CONVENTIONS §11 / §13). STAFF reçoit 403 sur les routes et une
 * redirection explicite ici, jamais une page blanche.
 */
export default async function AdminPromosPage() {
  const user = await requireCapability("promos:read");
  // Un seul ordre de tri et une seule horloge pour toute la page : le statut
  // d'une ligne ne peut pas contredire le compteur d'en-tête.
  const now = new Date();
  const promos = await listPromoCodes(now);

  const canWrite = staffCan(user, "promos:write");
  const activeCount = promos.filter((p) => p.status === "ACTIVE").length;
  const openEnded = promos.filter((p) => p.active && p.endsAt === null).length;
  const totalCostCents = promos.reduce((acc, p) => acc + p.discountTotalCents, 0);

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <h1 className="admin-page__title">Codes promo</h1>
          <p className="admin-page__sub">
            {promos.length} code{promos.length > 1 ? "s" : ""} · {activeCount} actif
            {activeCount > 1 ? "s" : ""} · {formatMoneyEur(totalCostCents)} de remises accordées
            au total.
          </p>
        </div>
        <Link href="/admin/orders" className="btn btn-secondary">
          Voir les commandes
        </Link>
      </div>

      <div className="notice enter enter-2">
        <p className="notice__title">Ce que ce chantier fait — et ce qu&apos;il ne fait pas</p>
        <p style={{ margin: 0 }}>
          Un seul code par commande, jamais deux remises empilées. La remise porte sur le{" "}
          <strong>sous-total des articles</strong> et ne peut jamais le dépasser : le total d&apos;une
          commande ne peut pas devenir négatif, et la <strong>livraison n&apos;est jamais remisée</strong>.
          Pas de ciblage par produit ni par catégorie en vague 2, pas de génération automatique de
          codes. Le montant remisé est recalculé par le serveur au moment de la commande : il ne
          vient jamais du navigateur du client.
        </p>
      </div>

      {openEnded > 0 ? (
        <div className="notice enter enter-2">
          <p className="notice__title">
            {openEnded} code{openEnded > 1 ? "s" : ""} actif{openEnded > 1 ? "s" : ""} sans date de
            fin
          </p>
          <p style={{ margin: 0 }}>
            Accepté, mais à surveiller : un code sans fin reste utilisable jusqu&apos;à ce que vous
            le désactiviez. Fixez une date de fin pour les campagnes datées.
          </p>
        </div>
      ) : null}

      <div className="enter enter-3">
        <DataTable
          caption="Codes promo, actifs d'abord puis du plus récent au plus ancien"
          rows={promos}
          getRowKey={(row) => row.id}
          rowClassName={(row) => (row.status === "ACTIVE" ? undefined : "data-table__row--muted")}
          emptyState={
            <div className="empty-state">
              <IconEuro className="empty-state__icon" />
              <p className="empty-state__title">Aucun code promo</p>
              <p className="empty-state__text">
                La liste est vide. Créez un premier code ci-dessous : il reste inactif tant que vous
                ne l&apos;activez pas, donc rien ne part en campagne par inadvertance.
              </p>
            </div>
          }
          columns={[
            {
              key: "code",
              header: "Code",
              nowrap: true,
              render: (row) => <span className="num">{row.code}</span>,
            },
            {
              key: "remise",
              header: "Remise",
              nowrap: true,
              render: (row) => <span>{describePromoRule(row)}</span>,
            },
            {
              key: "conditions",
              header: "Conditions",
              render: (row) => <span className="admin-muted">{conditionsLabel(row)}</span>,
            },
            {
              key: "validite",
              header: "Validité",
              render: (row) => <span className="admin-muted">{validityLabel(row)}</span>,
            },
            {
              key: "usage",
              header: "Utilisations",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="num">
                  {row.redemptions}
                  {row.maxRedemptions !== null ? ` / ${row.maxRedemptions}` : " / illimité"}
                </span>
              ),
            },
            {
              key: "cout",
              header: "Coût des remises",
              align: "right",
              nowrap: true,
              render: (row) => (
                <span className="money">{formatMoneyEur(row.discountTotalCents)}</span>
              ),
            },
            {
              key: "statut",
              header: "Statut",
              nowrap: true,
              render: (row) => (
                <span className={`badge ${statusBadgeClass(row.status)}`}>
                  {promoStatusLabel(row.status)}
                </span>
              ),
            },
            ...(canWrite
              ? [
                  {
                    key: "action",
                    header: "Action",
                    align: "right" as const,
                    nowrap: true,
                    render: (row: AdminPromoRow) => (
                      <PromoActions promoId={row.id} code={row.code} active={row.active} />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>

      {canWrite ? (
        <section className="card enter enter-4">
          <div className="admin-section__head">
            <h2 className="card__title">Créer un code</h2>
          </div>
          <p className="form-field__hint" style={{ marginBottom: "var(--sp-4)" }}>
            Le code est enregistré en majuscules : « bienvenue » et « BIENVENUE » sont le même code.
            Les montants sont saisis en euros ; la remise est plafonnée au sous-total de la
            commande.
          </p>
          <PromoCreateForm />
        </section>
      ) : null}
    </div>
  );
}

/** « Bientôt expiré » n'est pas un statut stockable : c'est une lecture utile. */
function conditionsLabel(row: AdminPromoRow): string {
  const parts: string[] = [];
  parts.push(
    row.minSubtotalCents > 0
      ? `Minimum ${formatMoneyEur(row.minSubtotalCents)} d'achats`
      : "Aucun minimum d'achat",
  );
  if (row.maxPerCustomer !== null) {
    parts.push(
      row.maxPerCustomer === 1
        ? "1 usage par client"
        : `${row.maxPerCustomer} usages par client`,
    );
  }
  return parts.join(" · ");
}

function validityLabel(row: AdminPromoRow): string {
  const from = row.startsAt ? formatDateTime(row.startsAt) : "tout de suite";
  const to = row.endsAt ? formatDateTime(row.endsAt) : "sans fin";
  return `Du ${from} au ${to}`;
}

function statusBadgeClass(status: PromoStatus): string {
  switch (status) {
    case "ACTIVE":
      return "badge-paid";
    case "SCHEDULED":
      return "badge-shipped";
    case "EXHAUSTED":
      return "badge-pending";
    case "EXPIRED":
    case "DISABLED":
      return status === "EXPIRED" ? "badge-cancelled" : "badge-neutral";
  }
}
