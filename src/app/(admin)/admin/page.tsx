import Link from "next/link";

import { JOB_FAILURE_ALERT_THRESHOLD, jobLabel, type JobFailureAlert } from "@/domain/jobs";
import { listJobFailureAlerts } from "@/server/admin-jobs";
import { loadDashboardData, type StockAlert } from "@/server/admin-stats";
import { requireCapability } from "@/server/guards";
import { DataTable, RowChevron } from "@/ui/components/admin/data-table";
import { OrderStatusBadge } from "@/ui/components/admin/order-status-badge";
import {
  PaymentMethodBadge,
  paymentMethodLabel,
} from "@/ui/components/admin/payment-method-badge";
import { StatCard, type StatTrend, type StatTrendTone } from "@/ui/components/admin/stat-card";
import { Money } from "@/ui/components/money";
import { formatDateTime, formatDayShort } from "@/ui/format";
import {
  IconCheck,
  IconEuro,
  IconOrders,
  IconTasks,
} from "@/ui/components/icons";

export const dynamic = "force-dynamic";

/**
 * Tableau de bord marchand.
 *
 * Tous les chiffres sortent de `loadDashboardData()` (src/server/admin-stats.ts) :
 * la page ne fait que mettre en forme. Les tendances comparent la fenêtre
 * courante (30 j) à la précédente, et chaque carte porte son historique 7 jours.
 */
export default async function AdminDashboardPage() {
  // Tableau de bord : lecture seule, ouverte aux deux rôles (CONVENTIONS §13).
  await requireCapability("dashboard:view");

  const now = new Date();
  const data = await loadDashboardData(now);
  // Alertes des tâches planifiées (AC J1) : un job qui échoue 3 fois de suite
  // doit se voir ICI, sans SSH ni fichier de log. Requête distincte du reste du
  // dashboard pour qu'un `JobRun` en échec ne puisse jamais être noyé dans les
  // statistiques de vente.
  const jobAlerts = await listJobFailureAlerts();

  const trendLabel = (pct: number | null) =>
    pct === null
      ? "aucune commande sur la période précédente"
      : `vs ${data.windowDays} jours précédents`;

  const tone = (direction: StatTrend["direction"], higherIsBetter: boolean): StatTrendTone => {
    if (direction === "flat") return "neutral";
    const isGood = direction === "up" ? higherIsBetter : !higherIsBetter;
    return isGood ? "positive" : "negative";
  };

  const series = (key: "revenueCents" | "orderCount" | "toProcessCount") =>
    data.series.map((bucket) => ({
      label: formatDayShort(bucket.dayStart),
      value: bucket[key],
    }));

  const revenueTrend: StatTrend = {
    ...data.revenue.trend,
    tone: tone(data.revenue.trend.direction, true),
    label: trendLabel(data.revenue.trend.pct),
  };
  const ordersTrend: StatTrend = {
    ...data.orders.trend,
    tone: tone(data.orders.trend.direction, true),
    label: trendLabel(data.orders.trend.pct),
  };
  const basketTrend: StatTrend = {
    ...data.basket.trend,
    tone: tone(data.basket.trend.direction, true),
    label: trendLabel(data.basket.trend.pct),
  };
  // Une file d'attente qui gonfle est une mauvaise nouvelle : la tendance est
  // volontairement inversée par rapport au chiffre d'affaires.
  const toProcessTrend: StatTrend = {
    ...data.toProcess.trend,
    tone: tone(data.toProcess.trend.direction, false),
    label: trendLabel(data.toProcess.trend.pct),
  };

  return (
    <div className="admin-page">
      <div className="admin-page__head enter enter-1">
        <div>
          <p className="eyebrow">Vue d&apos;ensemble</p>
          <h1 className="admin-page__title">Tableau de bord</h1>
          <p className="admin-page__sub">
            <span className="live-dot" aria-hidden /> Données actualisées le{" "}
            {formatDateTime(now)} — fenêtre de {data.windowDays} jours.
          </p>
        </div>
        <Link href="/admin/orders" className="btn btn-secondary">
          Toutes les commandes
        </Link>
      </div>

      {!data.hasAnyOrder ? (
        <>
          <div className="empty-state enter enter-2">
            <IconOrders className="empty-state__icon" />
            <p className="empty-state__title">Aucune commande pour le moment</p>
            <p className="empty-state__text">
              Dès la première commande, vous verrez ici le chiffre d&apos;affaires, le panier
              moyen, les commandes à traiter et les alertes de stock. En attendant, assurez-vous
              que votre catalogue est en ligne.
            </p>
            <div className="empty-state__actions">
              <Link href="/products" className="btn btn-primary">
                Voir le catalogue
              </Link>
              <Link href="/admin/products" className="btn btn-secondary">
                Gérer les produits
              </Link>
            </div>
          </div>
          <StockAlertsSection alerts={data.stockAlerts} className="enter enter-3" />
        </>
      ) : (
        <>
          <section className="admin-stats enter enter-2" aria-label="Indicateurs clés">
            <StatCard
              label={`Chiffre d'affaires (${data.windowDays} j)`}
              valueCents={data.revenue.current.revenueCents}
              currency={data.currency}
              trend={revenueTrend}
              spark={series("revenueCents")}
              sparkTitle="Chiffre d'affaires encaissé des 7 derniers jours"
              hint="Commandes encaissées uniquement (payées, expédiées, livrées)."
            />
            <StatCard
              label={`Commandes (${data.windowDays} j)`}
              valueText={`${data.orders.current}`}
              trend={ordersTrend}
              spark={series("orderCount")}
              sparkTitle="Commandes encaissées des 7 derniers jours"
              hint={`${data.totalOrderCount} commande(s) au total, tous statuts confondus.`}
            />
            <StatCard
              label={`Panier moyen (${data.windowDays} j)`}
              valueCents={data.basket.current}
              currency={data.currency}
              trend={basketTrend}
              spark={series("revenueCents")}
              sparkTitle="Chiffre d'affaires encaissé des 7 derniers jours"
              hint="Chiffre d'affaires divisé par le nombre de commandes encaissées."
            />
            <StatCard
              label="Commandes à traiter"
              valueText={`${data.toProcess.total}`}
              trend={toProcessTrend}
              spark={series("toProcessCount")}
              sparkTitle="Commandes à traiter passées ces 7 derniers jours"
              hint="En attente de paiement, payées ou en préparation — à encaisser ou à expédier."
            />
          </section>

          <section className="admin-section enter enter-3">
            <div className="admin-section__head">
              <h2 className="admin-section__title">Commandes récentes</h2>
              <Link href="/admin/orders">Tout voir →</Link>
            </div>
            <DataTable
                caption="Les 8 commandes les plus récentes"
                rows={data.recentOrders}
                getRowKey={(row) => row.id}
                rowHref={(row) => `/admin/orders/${row.id}`}
                rowLabel={(row) => `Ouvrir la commande ${row.number}`}
                emptyState={
                  <div className="empty-state">
                    <IconOrders className="empty-state__icon" />
                    <p className="empty-state__title">Aucune commande récente</p>
                    <p className="empty-state__text">
                      Les commandes apparaissent ici dès leur création.
                    </p>
                    <Link href="/products" className="btn btn-secondary">
                      Voir le catalogue
                    </Link>
                  </div>
                }
                columns={[
                  {
                    key: "number",
                    header: "Numéro",
                    nowrap: true,
                    render: (row) => <span className="num">{row.number}</span>,
                  },
                  {
                    key: "customer",
                    header: "Client",
                    render: (row) => (
                      <span>
                        {row.customerName}
                        <br />
                        <span className="admin-muted">{row.customerEmail}</span>
                      </span>
                    ),
                  },
                  {
                    key: "date",
                    header: "Date",
                    nowrap: true,
                    render: (row) => <span className="num">{formatDateTime(row.placedAt)}</span>,
                  },
                  {
                    key: "total",
                    header: "Total",
                    align: "right",
                    nowrap: true,
                    render: (row) => (
                      <span className="money">
                        <Money cents={row.totalCents} currency={row.currency} />
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Statut",
                    render: (row) => <OrderStatusBadge status={row.status} />,
                  },
                  {
                    key: "action",
                    header: "Action",
                    align: "right",
                    nowrap: true,
                    render: (row) => (
                      <Link href={`/admin/orders/${row.id}`}>
                        <RowChevron label={`Ouvrir la commande ${row.number}`} />
                      </Link>
                    ),
                  },
                ]}
              />
            </section>

          <div className="admin-columns enter enter-4">
            <StockAlertsSection alerts={data.stockAlerts} />

          <section className="admin-section">
            <div className="admin-section__head">
              <h2 className="admin-section__title">Méthodes de paiement ({data.windowDays} j)</h2>
              <span className="admin-muted">
                Total encaissé :{" "}
                <span className="money">
                  <Money cents={data.paymentsTotalCents} currency={data.currency} />
                </span>
              </span>
            </div>
            {data.payments.length === 0 ? (
              <div className="empty-state">
                <IconEuro className="empty-state__icon" />
                <p className="empty-state__title">Aucun encaissement sur la période</p>
                <p className="empty-state__text">
                  Aucune commande n&apos;a été payée sur les {data.windowDays} derniers jours :
                  il n&apos;y a rien à répartir.
                </p>
                <Link href="/admin/orders" className="btn btn-secondary">
                  Voir les commandes
                </Link>
              </div>
            ) : (
              <ul className="repartition">
                {data.payments.map((payment, index) => {
                  const pct = payment.share * 100;
                  const modifier =
                    index === 1 ? "progress__bar--alt" : index > 1 ? "progress__bar--muted" : "";
                  return (
                    <li key={payment.provider} className="repartition__row">
                      <div className="repartition__head">
                        <PaymentMethodBadge provider={payment.provider} />
                        <span className="num">{pct.toFixed(0)} %</span>
                      </div>
                      <div
                        className="progress"
                        role="img"
                        aria-label={`${paymentMethodLabel(payment.provider)} : ${pct.toFixed(0)} % du chiffre d'affaires encaissé, ${payment.orderCount} commande(s)`}
                      >
                        <span
                          className={modifier ? `progress__bar ${modifier}` : "progress__bar"}
                          style={{ width: `${pct.toFixed(1)}%` }}
                        />
                      </div>
                      <div className="repartition__meta">
                        <span>
                          {payment.orderCount} commande{payment.orderCount > 1 ? "s" : ""}
                        </span>
                        <span className="money">
                          <Money cents={payment.totalCents} currency={data.currency} />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          </div>
        </>
      )}

      {/* AC J1 — « la section Alertes affiche un avertissement si un même job a
          3 FAILED consécutifs ; en l'absence d'alertes, la section affiche
          explicitement « Aucune alerte » ». On la rend TOUJOURS, y compris sans
          commande : c'est justement quand la boutique est calme qu'un job cassé
          passe inaperçu. */}
      <JobAlertsSection alerts={jobAlerts} className="enter enter-5" />
    </div>
  );
}

/** Section « Alertes » — tâches planifiées en échec répété (lot J). */
function JobAlertsSection({
  alerts,
  className,
}: {
  alerts: readonly JobFailureAlert[];
  className?: string;
}) {
  return (
    <section className={className ? `admin-section ${className}` : "admin-section"}>
      <div className="admin-section__head">
        <h2 className="admin-section__title">Alertes</h2>
        <Link href="/admin/taches">Voir les tâches →</Link>
      </div>
      {alerts.length === 0 ? (
        <div className="empty-state">
          <IconCheck className="empty-state__icon" />
          {/* Un vide silencieux n'est pas une information : on dit
              explicitement que la surveillance est passée et n'a rien trouvé. */}
          <p className="empty-state__title">Aucune alerte</p>
          <p className="empty-state__text">
            Aucune tâche planifiée n&apos;a échoué {JOB_FAILURE_ALERT_THRESHOLD} fois de suite.
            La sauvegarde et la réconciliation des paiements tournent normalement.
          </p>
          <Link href="/admin/taches" className="btn btn-secondary">
            Voir le journal des tâches
          </Link>
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => (
            <li key={alert.name} className="alert-row alert-row--critical">
              <span>
                <span className="alert-row__name">{jobLabel(alert.name)}</span>
                <br />
                <span className="alert-row__meta">
                  <span className="num">{alert.name}</span> ·{" "}
                  {formatDateTime(alert.lastStartedAt)}
                  {alert.lastError ? (
                    <>
                      <br />
                      {alert.lastError}
                    </>
                  ) : null}
                </span>
              </span>
              <span className="badge badge-cancelled">
                <span aria-hidden>✕</span>
                {alert.consecutiveFailures} échecs
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Section « Alertes stock » — partagée entre le dashboard vide et le complet. */
function StockAlertsSection({
  alerts,
  className,
}: {
  alerts: readonly StockAlert[];
  className?: string;
}) {
  return (
    <section className={className ? `admin-section ${className}` : "admin-section"}>
      <div className="admin-section__head">
        <h2 className="admin-section__title">Alertes stock</h2>
        <Link href="/admin/stock">Gérer →</Link>
      </div>
      {alerts.length === 0 ? (
        <div className="empty-state">
          <IconCheck className="empty-state__icon" />
          <p className="empty-state__title">Aucune alerte de stock</p>
          <p className="empty-state__text">
            Toutes vos variantes ont plus de 5 unités disponibles. Rien à réapprovisionner
            aujourd&apos;hui.
          </p>
          <Link href="/admin/stock" className="btn btn-secondary">
            Voir le stock
          </Link>
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((alert) => (
            <li
              key={alert.variantId}
              className={
                alert.critical ? "alert-row alert-row--critical" : "alert-row alert-row--warning"
              }
            >
              <span>
                <span className="alert-row__name">{alert.productName}</span>
                <br />
                <span className="alert-row__meta">
                  {alert.variantName} · <span className="num">{alert.sku}</span>
                </span>
              </span>
              <span className="badge badge-neutral">
                <span aria-hidden>{alert.critical ? "✕" : "!"}</span>
                {alert.critical
                  ? "Rupture"
                  : `${alert.available} disponible${alert.available > 1 ? "s" : ""}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
