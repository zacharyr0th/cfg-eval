"use client";

import { useMemo, useState } from "react";
import { Download, Table2, BarChart3, LineChart as LineIcon, Sigma, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { rowsToCSV, downloadTextFile } from "@/lib/csv";
import { ResultTable } from "@/components/query/result-table";
import { ResultChart, getChartSpec } from "@/components/query/result-chart";
import { ResultStats } from "@/components/query/result-stats";
import { detectShape, defaultView, type ViewKind } from "@/lib/result-shape";

interface ResultViewProps {
  columns: string[];
  rows: unknown[][];
  /** The NL question this result answers, when there is one — gives the scalar caption its date context. */
  question?: string;
}

const VIEW_META: Record<ViewKind, { icon: typeof Table2; label: string }> = {
  stat: { icon: Sigma, label: "Stat" },
  chart: { icon: BarChart3, label: "Chart" },
  table: { icon: Table2, label: "Table" },
};

export function ResultView({ columns, rows, question }: ResultViewProps) {
  // Hooks run unconditionally (before the empty-result early return). The result
  // is fully present by the time this mounts (chat-turn only renders it once
  // executionMs has landed), so the initial view is computed from complete data.
  const shape = useMemo(() => detectShape(columns, rows), [columns, rows]);
  const chartSpec = useMemo(() => getChartSpec(columns, rows), [columns, rows]);
  const chartable = chartSpec !== null;

  // Offer views summarised → detailed; Table is always available.
  const views = useMemo(() => {
    const vs: ViewKind[] = [];
    if (shape.kind !== "table") vs.push("stat");
    if (chartable) vs.push("chart");
    vs.push("table");
    return vs;
  }, [shape.kind, chartable]);

  const [view, setView] = useState<ViewKind>(() =>
    defaultView({
      shape: shape.kind,
      chartable,
      temporalDefault: chartSpec ? chartSpec.temporal[chartSpec.defaultX] : false,
      rowCount: rows.length,
    }),
  );
  const active = views.includes(view) ? view : "table";

  // Bar vs line lives here (not in the chart) so the result toolbar carries every
  // primary control on one row instead of stacking a second control strip below.
  const [chartKind, setChartKind] = useState<"bar" | "line">(
    chartSpec && chartSpec.temporal[chartSpec.defaultX] ? "line" : "bar",
  );

  // A lone scalar (one row, one value) needs no view toggle and no CSV export —
  // there's nothing to switch to and nothing worth downloading.
  const isScalar = shape.kind === "scalar";

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/80 px-6 py-12 text-center backdrop-blur-md">
        <Inbox aria-hidden className="h-7 w-7 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">No rows matched</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          The query ran successfully but returned nothing. Try widening a date range or rephrasing the
          question.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Result ·{" "}
          <span className="tabular-nums normal-case text-foreground">
            {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
          </span>
        </h3>

        {!isScalar && (
          <div className="flex items-center gap-2">
            {active === "chart" && chartable && (
              <div className="inline-flex overflow-hidden rounded-lg border" role="group" aria-label="Chart type">
                <ViewButton asTab={false} active={chartKind === "bar"} onClick={() => setChartKind("bar")} icon={BarChart3} label="Bar" />
                <ViewButton asTab={false} active={chartKind === "line"} onClick={() => setChartKind("line")} icon={LineIcon} label="Line" />
              </div>
            )}
            {views.length > 1 && (
              <div className="inline-flex overflow-hidden rounded-lg border" role="tablist" aria-label="Result view">
                {views.map((v) => (
                  <ViewButton
                    key={v}
                    active={active === v}
                    onClick={() => setView(v)}
                    icon={VIEW_META[v].icon}
                    label={VIEW_META[v].label}
                  />
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadTextFile("query-results.csv", rowsToCSV(columns, rows))}
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        )}
      </div>

      {active === "stat" && shape.kind !== "table" ? (
        <ResultStats shape={shape} question={question} />
      ) : active === "chart" && chartable ? (
        <ResultChart columns={columns} rows={rows} kind={chartKind} />
      ) : (
        <ResultTable columns={columns} rows={rows} />
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  label,
  asTab = true,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Table2;
  label: string;
  /** Tab semantics for the view tablist; a plain pressed toggle for the chart-type group. */
  asTab?: boolean;
}) {
  return (
    <button
      type="button"
      role={asTab ? "tab" : undefined}
      aria-selected={asTab ? active : undefined}
      aria-pressed={asTab ? undefined : active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60",
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
