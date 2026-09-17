import { Money } from "@/ui/components/money";
import { Sparkline, type SparkPoint } from "./sparkline";

/**
 * Carte de métrique : libellé, valeur, tendance vs période précédente, et
 * historique 7 jours en barres.
 *
 * La tendance n'est JAMAIS portée par la couleur seule : flèche (↑ / ↓ / →),
 * pourcentage signé, et texte lu par les lecteurs d'écran.
 */

export type StatTrendTone = "positive" | "negative" | "neutral";
export type StatTrendDirection = "up" | "down" | "flat";

export type StatTrend = {
  /** Variation en %, `null` quand la période précédente est vide (pas de base). */
  pct: number | null;
  direction: StatTrendDirection;
  tone: StatTrendTone;
  /** Contexte de comparaison, ex. "vs 30 jours précédents". */
  label: string;
};

export type StatCardProps = {
  label: string;
  /** Montant en centimes — affiché via <Money />. */
  valueCents?: number;
  currency?: string;
  /** Valeur non monétaire (compteur) — affichée en chiffres alignés. */
  valueText?: string;
  trend?: StatTrend;
  spark?: readonly SparkPoint[];
  /** Décrit la série du mini-graphe pour l'accessibilité. */
  sparkTitle?: string;
  hint?: string;
  className?: string;
};

const ARROW: Record<StatTrendDirection, string> = { up: "↑", down: "↓", flat: "→" };
const DIRECTION_WORD: Record<StatTrendDirection, string> = {
  up: "en hausse",
  down: "en baisse",
  flat: "stable",
};

function formatPct(pct: number | null): string {
  if (pct === null) return "n/a";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")} %`;
}

export function StatCard({
  label,
  valueCents,
  currency = "EUR",
  valueText,
  trend,
  spark,
  sparkTitle,
  hint,
  className,
}: StatCardProps) {
  return (
    <article className={className ? `card stat-card ${className}` : "card stat-card"}>
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">
        {valueCents !== undefined ? (
          <span className="money">
            <Money cents={valueCents} currency={currency} />
          </span>
        ) : (
          <span className="num">{valueText ?? "—"}</span>
        )}
      </p>

      {trend ? (
        <p className={`stat-card__trend stat-card__trend--${trend.tone}`}>
          <span className="stat-card__arrow" aria-hidden>
            {ARROW[trend.direction]}
          </span>
          <span className="stat-card__pct">{formatPct(trend.pct)}</span>
          <span className="sr-only">{DIRECTION_WORD[trend.direction]} — </span>
          <span>{trend.label}</span>
        </p>
      ) : null}

      {spark && spark.length > 0 ? (
        <div className="stat-card__spark">
          <Sparkline points={spark} title={sparkTitle ?? label} />
        </div>
      ) : null}

      {hint ? <p className="stat-card__hint">{hint}</p> : null}
    </article>
  );
}
