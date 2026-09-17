/**
 * Mini graphe en barres — CSS pur, aucune librairie.
 *
 * Une barre par point, hauteur relative au maximum de la série. La série
 * entière est décrite dans l'`aria-label` : un lecteur d'écran reçoit les
 * valeurs, pas un dessin muet.
 */

export type SparkPoint = {
  /** Libellé court affiché en infobulle (ex. "lun. 15"). */
  label: string;
  /** Valeur numérique du point (centimes ou nombre de commandes). */
  value: number;
};

export type SparklineProps = {
  points: readonly SparkPoint[];
  /** Décrit la série (ex. "Chiffre d'affaires des 7 derniers jours"). */
  title: string;
};

/** Hauteur plancher d'une barre : un point à zéro reste visible. */
const MIN_HEIGHT_PCT = 6;

export function Sparkline({ points, title }: SparklineProps) {
  if (points.length === 0) return null;

  const max = points.reduce((acc, p) => (p.value > acc ? p.value : acc), 0);
  const summary = points.map((p) => `${p.label} : ${p.value}`).join(" · ");
  const lastIndex = points.length - 1;

  return (
    <div className="sparkline" role="img" aria-label={`${title}. ${summary}`}>
      {points.map((point, index) => {
        const rawHeight = max > 0 ? (point.value / max) * 100 : 0;
        const height = Math.max(rawHeight, MIN_HEIGHT_PCT);
        const modifier =
          point.value <= 0
            ? "sparkline__bar--zero"
            : index === lastIndex
              ? "sparkline__bar--today"
              : "";
        return (
          <span
            key={`${point.label}-${index}`}
            className={modifier ? `sparkline__bar ${modifier}` : "sparkline__bar"}
            style={{ height: `${height.toFixed(2)}%` }}
            title={`${point.label} : ${point.value}`}
          />
        );
      })}
    </div>
  );
}
