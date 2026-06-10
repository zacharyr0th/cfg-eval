"use client";

import { cn } from "@/lib/utils";
import {
  cellTitle,
  formatCell,
  formatCompact,
  formatCurrencyNumber,
  formatNumber,
  humanizeLabel,
  questionDateContext,
  statUnit,
  toNumber,
  withUnit,
} from "@/lib/format";
import type { ResultShape, Stat } from "@/lib/result-shape";

/** Headline stats compact past a million so the card doesn't sprawl; full value on hover. */
const COMPACT_THRESHOLD = 1_000_000;

/**
 * Renders a scalar or single-row-of-metrics result as a headline number instead
 * of a 1×N table — the "20,825 trips" answer reads as a first-class result.
 * A lone scalar gets a clean, chrome-free number + caption; a row of metrics
 * still uses cards so the values stay visually separated.
 */
export function ResultStats({
  shape,
  question,
}: {
  shape: Extract<ResultShape, { kind: "scalar" | "metrics" }>;
  /** The NL question this result answers, for date context in the scalar caption. */
  question?: string;
}) {
  if (shape.kind === "scalar") return <ScalarStat stat={shape.stat} question={question} />;

  return (
    <div className={cn("grid gap-3", gridCols(shape.stats.length))}>
      {shape.stats.map((s) => (
        <StatCard key={s.label} stat={s} />
      ))}
    </div>
  );
}

/**
 * Display string + hover title for a stat value, with the column's unit applied
 * ("$4.20", "2.3 mi", "167.6M"). The title carries the exact value whenever the
 * headline abbreviates or rounds it, preferring the raw cell when even the
 * grouped form is lossy.
 */
function statParts(stat: Stat): { display: string; title: string | undefined } {
  const num = toNumber(stat.value);
  if (num === null) return { display: formatCell(stat.value), title: cellTitle(stat.value) };

  const unit = statUnit(stat.label);
  const compact = Math.abs(num) >= COMPACT_THRESHOLD;
  const display = withUnit(
    compact ? formatCompact(num) : unit === "currency" ? formatCurrencyNumber(num) : formatNumber(num),
    unit,
  );
  const exact = withUnit(formatNumber(num), unit);
  const raw = cellTitle(stat.value);
  return { display, title: display === exact ? raw : (raw ?? exact) };
}

/** A single answer: big number, no border/fill, humanized caption beneath. */
function ScalarStat({ stat, question }: { stat: Stat; question?: string }) {
  const isNull = stat.value === null || stat.value === undefined;
  const { display, title } = statParts(stat);
  // "Trips on Aug 15, 2015" — the date comes verbatim from the user's question,
  // so the caption adds context without guessing at the SQL's filters.
  const context = question ? questionDateContext(question) : "";
  const caption = context ? `${humanizeLabel(stat.label)} ${context}` : humanizeLabel(stat.label);
  return (
    <div className="py-1">
      <p
        title={title}
        className={cn(
          "break-words tabular-nums",
          stat.numeric ? "text-4xl font-semibold tracking-tight" : "text-2xl font-medium",
          isNull && "text-muted-foreground/50",
        )}
      >
        {display}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">{caption}</p>
    </div>
  );
}

function StatCard({ stat }: { stat: Stat }) {
  const isNull = stat.value === null || stat.value === undefined;
  const { display, title } = statParts(stat);
  const label = humanizeLabel(stat.label);
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-sm)]">
      <p title={label} className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        title={title}
        className={cn(
          "mt-2 break-words tabular-nums",
          stat.numeric ? "text-3xl font-semibold tracking-tight" : "text-lg font-medium",
          isNull && "text-muted-foreground/50",
        )}
      >
        {display}
      </p>
    </div>
  );
}

/** Responsive column count for the card grid; literal class strings so Tailwind's JIT keeps them. */
function gridCols(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-1 sm:grid-cols-2";
  if (n === 3) return "grid-cols-1 sm:grid-cols-3";
  return "grid-cols-2 lg:grid-cols-4"; // 4–6 metrics
}
