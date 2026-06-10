"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  cellTitle,
  formatCell,
  humanizeLabel,
  isNumericColumn,
  isTemporalColumn,
  parseTemporal,
  toNumber,
} from "@/lib/format";
import { measureColumns } from "@/lib/result-shape";

const PAGE_SIZE = 50;

type SortState = { col: number; dir: "asc" | "desc" } | null;

interface ResultTableProps {
  columns: string[];
  rows: unknown[][];
}

function compareCells(a: unknown, b: unknown, numeric: boolean, temporal: boolean): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls sort last regardless of direction
  if (bNull) return -1;
  if (numeric) return (toNumber(a) ?? 0) - (toNumber(b) ?? 0);
  if (temporal) {
    return (parseTemporal(a)?.getTime() ?? 0) - (parseTemporal(b)?.getTime() ?? 0);
  }
  return String(a).localeCompare(String(b));
}

export function ResultTable({ columns, rows }: ResultTableProps) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);

  const colMeta = useMemo(
    () =>
      columns.map((_, i) => ({
        numeric: isNumericColumn(rows, i),
        temporal: isTemporalColumn(rows, i),
      })),
    [columns, rows],
  );

  // Per-measure-column maxima for the in-cell data bars. Computed over the full
  // result (not the page) so a bar's length is stable across paging/sorting, and
  // only for all-non-negative columns where a left-to-right magnitude bar is
  // meaningful — a column with a negative value gets no bars.
  const barMax = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of measureColumns(columns, rows)) {
      let max = 0;
      let ok = true;
      for (const r of rows) {
        const v = toNumber(r[c]);
        if (v === null) continue;
        if (v < 0) {
          ok = false;
          break;
        }
        if (v > max) max = v;
      }
      if (ok && max > 0) m.set(c, max);
    }
    return m;
  }, [columns, rows]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const { col, dir } = sort;
    const { numeric, temporal } = colMeta[col];
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((ra, rb) => factor * compareCells(ra[col], rb[col], numeric, temporal));
  }, [rows, sort, colMeta]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = sortedRows.slice(start, start + PAGE_SIZE);

  function toggleSort(col: number) {
    setPage(0);
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null; // third click clears the sort
    });
  }

  return (
    <div>
      <div className="overflow-auto rounded-xl border bg-card shadow-[var(--shadow-sm)]">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Query result: {rows.length} row{rows.length === 1 ? "" : "s"}, {columns.length} column
            {columns.length === 1 ? "" : "s"} ({columns.join(", ")}). Numeric columns show a magnitude bar
            behind the value.
          </caption>
          <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
            <tr>
              {columns.map((c, i) => {
                const active = sort?.col === i;
                const label = humanizeLabel(c);
                return (
                  <th
                    key={c}
                    scope="col"
                    aria-sort={active && sort ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className="border-b p-0 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(i)}
                      aria-label={`Sort by ${label}${active && sort ? `, currently ${sort.dir === "asc" ? "ascending" : "descending"}` : ""}`}
                      className={cn(
                        "flex w-full items-center gap-1.5 px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        colMeta[i].numeric && "justify-end text-right",
                      )}
                    >
                      <span className="truncate" title={c}>{label}</span>
                      {active ? (
                        sort.dir === "asc" ? (
                          <ArrowUp aria-hidden className="h-3.5 w-3.5 shrink-0 text-foreground" />
                        ) : (
                          <ArrowDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-foreground" />
                        )
                      ) : (
                        <ChevronsUpDown
                          aria-hidden
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40"
                        />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={start + i} className="border-b last:border-0 hover:bg-muted/30">
                {row.map((cell, j) => {
                  const max = barMax.get(j);
                  const value = max != null ? toNumber(cell) : null;
                  const pct =
                    value != null && value >= 0 && max ? Math.min(100, (value / max) * 100) : null;
                  return (
                    <td
                      key={j}
                      className={cn(
                        "relative px-3 py-2 text-xs",
                        colMeta[j].numeric
                          ? "text-right font-mono tabular-nums"
                          : "text-left text-[13px]",
                        (cell === null || cell === undefined) && "text-muted-foreground/50",
                      )}
                    >
                      {pct !== null && (
                        <span aria-hidden className="pointer-events-none absolute inset-y-1 left-1 right-1 z-0 flex justify-end">
                          <span
                            className="h-full rounded-sm"
                            style={{ width: `${pct}%`, backgroundColor: "hsl(var(--chart-1))", opacity: 0.16 }}
                          />
                        </span>
                      )}
                      {/* Exact raw value on hover whenever display rounding loses precision. */}
                      <span className="relative z-10" title={cellTitle(cell)}>{formatCell(cell)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedRows.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing <span className="tabular-nums text-foreground">{start + 1}</span>–
            <span className="tabular-nums text-foreground">{start + pageRows.length}</span> of{" "}
            <span className="tabular-nums text-foreground">{sortedRows.length}</span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <span className="tabular-nums">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
