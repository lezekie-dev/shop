import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Tableau de données admin : en-tête, lignes, état vide intégré, et défilement
 * horizontal sur mobile (jamais de tableau qui déborde de l'écran).
 *
 * L'état vide n'est pas laissé à l'appelant au cas par cas : il est obligatoire
 * (`emptyState` requis) — impossible de rendre un tableau blanc muet.
 */

export type DataTableColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  nowrap?: boolean;
  render: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T) => string;
  /** Légende lue par les lecteurs d'écran (le titre visible est à côté). */
  caption: string;
  /** Rend la ligne entière cliquable vers cette URL. */
  rowHref?: (row: T) => string;
  /** Libellé accessible du lien de ligne. */
  rowLabel?: (row: T) => string;
  /** Rendu quand `rows` est vide — emoji + titre + explication + action. */
  emptyState: ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  rowHref,
  rowLabel,
  emptyState,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <>{emptyState}</>;
  }

  const firstKey = columns[0]?.key;

  return (
    <div className="data-table__wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.align === "right" ? "data-table__cell--right" : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr key={getRowKey(row)} className={href ? "data-table__row" : undefined}>
                {columns.map((column) => {
                  const isFirst = column.key === firstKey;
                  const classes = [
                    column.align === "right" ? "data-table__cell--right" : "",
                    column.nowrap ? "data-table__cell--nowrap" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={column.key} className={classes || undefined}>
                      {href && isFirst ? (
                        <Link
                          href={href}
                          className="data-table__row-link"
                          aria-label={rowLabel?.(row) ?? "Voir le détail"}
                        />
                      ) : null}
                      {column.render(row)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Cellule de cellule « action » : chevron cohérent pour toutes les listes. */
export function RowChevron({ label = "Voir" }: { label?: string }) {
  return (
    <span className="row-chevron">
      <span aria-hidden>→</span> <span className="sr-only">{label}</span>
    </span>
  );
}
