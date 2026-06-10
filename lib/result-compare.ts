/**
 * Result-set comparison — the single correctness judgement shared by the vitest
 * eval suite (tests/eval-helpers.ts) and the in-app eval runner (/api/evals).
 * Pure data-in/data-out so it is safe to import anywhere.
 *
 *   - "set": rows compared as a multiset (order-insensitive, for unordered aggs)
 *   - "ordered": exact row order (when ORDER BY is part of the question)
 *   - "scalar": single-row, single-cell numeric comparison with tolerance
 */

export type CompareMode = "set" | "ordered" | "scalar";

/** The minimal result shape compared — any {columns, rows} result fits. */
export interface ComparableResult {
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

export function compareResults(
  expected: ComparableResult,
  actual: ComparableResult,
  mode: CompareMode,
  tolerance = 0.0001,
): boolean {
  if (mode === "scalar") {
    if (expected.rows.length !== 1 || actual.rows.length !== 1) return false;
    if (expected.columns.length !== 1 || actual.columns.length !== 1) return false;
    const e = numeric(expected.rows[0][0]);
    const a = numeric(actual.rows[0][0]);
    if (e === null || a === null) return false;
    const denom = Math.max(Math.abs(e), 1);
    return Math.abs(e - a) / denom <= tolerance;
  }
  if (expected.rows.length !== actual.rows.length) return false;
  if (expected.columns.length !== actual.columns.length) return false;
  const eRows = expected.rows.map(rowKey);
  const aRows = actual.rows.map(rowKey);
  if (mode === "ordered") {
    return eRows.every((row, i) => row === aRows[i]);
  }
  // set mode: multiset equality
  const counts = new Map<string, number>();
  for (const row of eRows) counts.set(row, (counts.get(row) ?? 0) + 1);
  for (const row of aRows) {
    const c = counts.get(row);
    if (!c) return false;
    if (c === 1) counts.delete(row);
    else counts.set(row, c - 1);
  }
  return counts.size === 0;
}

function rowKey(row: ReadonlyArray<unknown>): string {
  return row.map((v) => (typeof v === "number" ? v.toFixed(4) : String(v ?? "∅"))).join("|");
}

function numeric(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
