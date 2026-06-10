/**
 * Shape detection for a query result, so the UI can render the *right* primitive
 * instead of always dumping a table.
 *
 * A SQL result has a few recognisable shapes:
 *
 *   - **scalar**  — one row, one column (`count() = 20825`). Best shown as a
 *     single big number, not a 1×1 table.
 *   - **metrics** — one row, a handful of columns, at least one numeric
 *     (`total_fares | total_trips | avg_distance`). Best shown as a row of
 *     stat cards.
 *   - **table**   — everything else (the existing sortable/paginated grid).
 *
 * This module is intentionally pure (depends only on lib/format) so the decision
 * is unit-testable without React, d3, or a DOM.
 */

import { isNumericColumn, isNumericValue, isTemporalColumn } from "@/lib/format";

/** A single labelled value rendered as a stat card. */
export interface Stat {
  label: string;
  value: unknown;
  numeric: boolean;
}

export type ResultShape =
  | { kind: "scalar"; stat: Stat }
  | { kind: "metrics"; stats: Stat[] }
  | { kind: "table" };

/** Past this many columns a single row reads better as a (scrollable) table than as cards. */
const MAX_METRIC_CARDS = 6;

function toStat(label: string, value: unknown): Stat {
  return { label, value, numeric: isNumericValue(value) };
}

/**
 * Classify a result by its shape. Only single-row results become scalar/metrics;
 * anything with 0 or 2+ rows is a table.
 */
export function detectShape(columns: string[], rows: unknown[][]): ResultShape {
  if (rows.length !== 1) return { kind: "table" };
  const row = rows[0];

  if (columns.length === 1) {
    return { kind: "scalar", stat: toStat(columns[0], row[0]) };
  }

  if (columns.length >= 2 && columns.length <= MAX_METRIC_CARDS) {
    const stats = columns.map((c, i) => toStat(c, row[i]));
    // A single row of pure labels (no numeric cell) isn't a metrics dashboard —
    // fall through to the table, where the header/columns carry the meaning.
    if (stats.some((s) => s.numeric)) return { kind: "metrics", stats };
  }

  return { kind: "table" };
}

/**
 * The numeric "measure" columns of a result — the ones worth drawing data bars
 * behind. A measure is a numeric, non-temporal column that isn't the result's
 * dimension axis, so `(hour, trips)` bars `trips` but not `hour`, and
 * `(payment_type, fares, trips)` bars both `fares` and `trips`. A lone numeric
 * column is itself a measure. Mirrors how the chart picks its X axis (first
 * temporal, else first categorical) but stays pure so the table can use it too.
 */
export function measureColumns(columns: string[], rows: unknown[][]): number[] {
  const numeric = columns.map((_, i) => isNumericColumn(rows, i));
  const temporal = columns.map((_, i) => isTemporalColumn(rows, i));
  const measures = columns.map((_, i) => i).filter((i) => numeric[i] && !temporal[i]);
  if (measures.length === 0) return [];
  if (columns.length === 1) return measures;

  const firstTemporal = temporal.findIndex(Boolean);
  const firstCategorical = numeric.findIndex((n) => !n);
  const dimension = firstTemporal >= 0 ? firstTemporal : firstCategorical >= 0 ? firstCategorical : measures[0];
  return measures.filter((i) => i !== dimension);
}

export type ViewKind = "stat" | "chart" | "table";

/** Auto-chart categorical results only when there are few enough bars to stay readable. */
const AUTO_CHART_MAX_ROWS = 30;

/**
 * Pick the view a result should open in. Summarised shapes win (a scalar should
 * never open as a table); time series and small top-N lists open as a chart; the
 * long tail opens as a table.
 */
export function defaultView(opts: {
  shape: ResultShape["kind"];
  chartable: boolean;
  /** The chart's default X encoding is a date/time column. */
  temporalDefault: boolean;
  rowCount: number;
}): ViewKind {
  if (opts.shape === "scalar" || opts.shape === "metrics") return "stat";
  if (opts.chartable && (opts.temporalDefault || opts.rowCount <= AUTO_CHART_MAX_ROWS)) {
    return "chart";
  }
  return "table";
}
