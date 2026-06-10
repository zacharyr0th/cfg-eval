"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scaleBand, scaleLinear, scaleUtc } from "d3-scale";
import { line as d3line, curveMonotoneX } from "d3-shape";
import { max as d3max, min as d3min } from "d3-array";
import { format as d3format } from "d3-format";
import { utcFormat } from "d3-time-format";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cellTitle,
  formatCell,
  formatNumber,
  humanizeLabel,
  isNumericColumn,
  isTemporalColumn,
  parseTemporal,
  toNumber,
} from "@/lib/format";

const HEIGHT = 340;
const MAX_BARS = 40;
const COMPACT = d3format("~s"); // 1.2M, 3.4k — for y-axis ticks

interface ResultChartProps {
  columns: string[];
  rows: unknown[][];
  /** Bar vs line is owned by the result toolbar so it sits on one control row. */
  kind: "bar" | "line";
}

interface ChartSpec {
  /** Column indices usable as the category/time axis. */
  xCandidates: number[];
  /** Numeric column indices usable as the value axis. */
  yCandidates: number[];
  defaultX: number;
  defaultY: number;
  temporal: boolean[];
}

/**
 * Decide whether a result is worth charting and pick sensible default
 * encodings. Returns null when there's nothing meaningful to plot (no numeric
 * column, a single row, or a single column).
 */
export function getChartSpec(columns: string[], rows: unknown[][]): ChartSpec | null {
  if (columns.length < 2 || rows.length < 2) return null;
  const numeric = columns.map((_, i) => isNumericColumn(rows, i));
  const temporal = columns.map((_, i) => isTemporalColumn(rows, i));
  const yCandidates = columns.map((_, i) => i).filter((i) => numeric[i] && !temporal[i]);
  if (yCandidates.length === 0) return null;

  const firstTemporal = temporal.findIndex(Boolean);
  const firstCategorical = numeric.findIndex((n) => !n);
  const defaultX = firstTemporal >= 0 ? firstTemporal : firstCategorical >= 0 ? firstCategorical : 0;
  const defaultY = yCandidates.find((i) => i !== defaultX) ?? yCandidates[0];

  // Any column can serve as a label axis; values must be numeric.
  const xCandidates = columns.map((_, i) => i);
  return { xCandidates, yCandidates, defaultX, defaultY, temporal };
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ResultChart({ columns, rows, kind }: ResultChartProps) {
  const spec = useMemo(() => getChartSpec(columns, rows), [columns, rows]);
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [x, setX] = useState(spec?.defaultX ?? 0);
  const [y, setY] = useState(spec?.defaultY ?? 0);
  // Axis pickers stay hidden until asked for — the default encodings are right
  // almost always, so the chart renders clean and the controls don't read as noise.
  const [customizing, setCustomizing] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  if (!spec) {
    return (
      <div className="rounded-xl border bg-card/90 p-8 text-center text-sm text-muted-foreground shadow-[var(--shadow-sm)] backdrop-blur-md">
        This result isn&rsquo;t chartable — a chart needs at least one numeric column and two rows.
        Switch back to the table view.
      </div>
    );
  }

  // Build the plotted series from the chosen encodings, dropping null values —
  // and COUNTING the drops, so the caption can disclose them instead of the
  // chart silently rendering fewer points than the result has rows.
  const allPoints = rows
    .map((r, idx) => ({
      idx,
      label: formatCell(r[x]),
      date: parseTemporal(r[x]),
      value: toNumber(r[y]),
    }))
    .filter((d): d is { idx: number; label: string; date: Date | null; value: number } => d.value !== null);
  const omittedNulls = rows.length - allPoints.length;

  const xIsTemporal = spec.temporal[x];
  const points =
    kind === "line" && xIsTemporal
      ? allPoints.filter((d) => d.date).sort((a, b) => a.date!.getTime() - b.date!.getTime())
      : allPoints;

  const truncated = kind === "bar" && points.length > MAX_BARS;
  const shown = truncated ? points.slice(0, MAX_BARS) : points;

  const values = shown.map((d) => d.value);
  const yMin = Math.min(0, d3min(values) ?? 0);
  const yMax = Math.max(0, d3max(values) ?? 1);
  const yDomainScale = scaleLinear().domain([yMin, yMax]).nice();
  const yTicks = yDomainScale.ticks(5);
  const leftMargin = Math.min(
    96,
    Math.max(48, Math.max(...yTicks.map((t) => COMPACT(t).length)) * 7 + 20),
  );

  const margin = { top: 16, right: 18, bottom: kind === "bar" ? 76 : 44, left: leftMargin };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = HEIGHT - margin.top - margin.bottom;

  const yScale = scaleLinear().domain(yDomainScale.domain()).range([innerH, 0]);
  const xBand = scaleBand<number>()
    .domain(shown.map((d) => d.idx))
    .range([0, innerW])
    .padding(0.2);

  const timeExtent: [Date, Date] =
    xIsTemporal && shown.length
      ? [shown[0].date ?? new Date(0), shown[shown.length - 1].date ?? new Date(0)]
      : [new Date(0), new Date(0)];
  const xTime = scaleUtc().domain(timeExtent).range([0, innerW]).nice();

  // X tick labels: thin categorical labels so they don't overlap; multi-scale
  // format for time.
  const labelEvery = Math.max(1, Math.ceil(shown.length / Math.max(2, Math.floor(innerW / 64))));
  const spanDays =
    (timeExtent[1].getTime() - timeExtent[0].getTime()) / 86_400_000;
  const timeFmt = utcFormat(spanDays > 90 ? "%b" : spanDays > 2 ? "%b %d" : "%b %d %H:%M");

  function pointX(d: { idx: number; date: Date | null }): number {
    if (kind === "line" && xIsTemporal) return xTime(d.date ?? new Date(0));
    return (xBand(d.idx) ?? 0) + xBand.bandwidth() / 2;
  }

  const linePath =
    kind === "line"
      ? d3line<(typeof shown)[number]>()
          .x((d) => pointX(d))
          .y((d) => yScale(d.value))
          .curve(curveMonotoneX)(shown) ?? ""
      : "";

  const hovered = hover === null ? null : shown.find((d) => d.idx === hover) ?? null;

  // Text alternative for the SVG so the chart conveys its data to screen readers,
  // not just an axis pairing (HIG: "make every chart accessible").
  const valueLo = values.length ? Math.min(...values) : 0;
  const valueHi = values.length ? Math.max(...values) : 0;
  const yLabel = humanizeLabel(columns[y]);
  const xLabel = humanizeLabel(columns[x]);
  const chartSummary =
    `${yLabel} by ${xLabel}: ${kind} chart, ${shown.length} point${shown.length === 1 ? "" : "s"}, ` +
    `${yLabel} from ${formatNumber(valueLo)} to ${formatNumber(valueHi)}.` +
    (truncated ? ` Showing the first ${MAX_BARS} of ${points.length}.` : "") +
    (omittedNulls > 0 ? ` ${omittedNulls} row${omittedNulls === 1 ? "" : "s"} with a null value omitted.` : "") +
    " Switch to the Table view for every row as text.";

  return (
    <div className="rounded-xl border bg-card/90 p-3 shadow-[var(--shadow-sm)] backdrop-blur-md sm:p-4">
      {/* Axis pickers, revealed on demand — bar/line lives up in the result toolbar. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs">
        <button
          type="button"
          onClick={() => setCustomizing((c) => !c)}
          aria-expanded={customizing}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            customizing && "text-foreground",
          )}
        >
          <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
          Customize
        </button>
        {customizing && (
          <>
            <Encoding label="X" value={x} onChange={setX} columns={columns} indices={spec.xCandidates} />
            <Encoding label="Y" value={y} onChange={setY} columns={columns} indices={spec.yCandidates} />
          </>
        )}
      </div>

      <div ref={containerRef} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={chartSummary}>
            <g transform={`translate(${margin.left},${margin.top})`}>
              {/* Y gridlines + ticks */}
              {yTicks.map((t) => (
                <g key={t} transform={`translate(0,${yScale(t)})`}>
                  <line x1={0} x2={innerW} className="stroke-border" strokeDasharray="2,3" />
                  <text x={-10} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
                    {COMPACT(t)}
                  </text>
                </g>
              ))}

              {/* Zero baseline */}
              <line x1={0} x2={innerW} y1={yScale(0)} y2={yScale(0)} className="stroke-border" />

              {/* Bars */}
              {kind === "bar" &&
                shown.map((d) => {
                  const bx = xBand(d.idx) ?? 0;
                  const top = yScale(Math.max(0, d.value));
                  const h = Math.abs(yScale(d.value) - yScale(0));
                  return (
                    <rect
                      key={d.idx}
                      x={bx}
                      y={top}
                      width={xBand.bandwidth()}
                      height={h}
                      rx={Math.min(4, xBand.bandwidth() / 4)}
                      style={{ fill: "hsl(var(--chart-1))" }}
                      className={cn("transition-opacity", hover !== null && hover !== d.idx && "opacity-40")}
                      onMouseEnter={() => setHover(d.idx)}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}

              {/* Line + dots */}
              {kind === "line" && (
                <>
                  <path d={linePath} fill="none" strokeWidth={2} style={{ stroke: "hsl(var(--chart-1))" }} />
                  {shown.map((d) => (
                    <circle
                      key={d.idx}
                      cx={pointX(d)}
                      cy={yScale(d.value)}
                      r={hover === d.idx ? 5 : 3}
                      style={{ fill: "hsl(var(--chart-1))" }}
                      className="transition-[r]"
                      onMouseEnter={() => setHover(d.idx)}
                      onMouseLeave={() => setHover(null)}
                    />
                  ))}
                </>
              )}

              {/* X axis labels */}
              {kind === "bar"
                ? shown.map((d, i) =>
                    i % labelEvery === 0 ? (
                      <text
                        key={d.idx}
                        transform={`translate(${(xBand(d.idx) ?? 0) + xBand.bandwidth() / 2},${innerH + 12}) rotate(-35)`}
                        textAnchor="end"
                        className="fill-muted-foreground text-[10px]"
                      >
                        {xIsTemporal && d.date ? timeFmt(d.date) : d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label}
                      </text>
                    ) : null,
                  )
                : xTime.ticks(Math.max(2, Math.floor(innerW / 90))).map((t) => (
                    <text
                      key={+t}
                      x={xTime(t)}
                      y={innerH + 18}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {timeFmt(t)}
                    </text>
                  ))}
            </g>
          </svg>
        )}

        {/* Tooltip */}
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[120%] whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-[var(--shadow-md)]"
            style={{ left: margin.left + pointX(hovered), top: margin.top + yScale(hovered.value) }}
          >
            <span className="text-muted-foreground">{hovered.label}</span>
            <span className="mx-1.5 text-border">·</span>
            {/* The exact value when display rounding would lose precision — a
                tooltip is the one place there's room for every digit. */}
            <span className="font-medium tabular-nums text-foreground">
              {cellTitle(hovered.value) ?? formatNumber(hovered.value)}
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/70">{yLabel}</span> by{" "}
        <span className="font-medium text-foreground/70">{xLabel}</span>
        {truncated && ` · showing first ${MAX_BARS} of ${points.length}`}
        {omittedNulls > 0 && ` · ${omittedNulls} null row${omittedNulls === 1 ? "" : "s"} omitted`}
      </p>
    </div>
  );
}

function Encoding({
  label,
  value,
  onChange,
  columns,
  indices,
}: {
  label: string;
  value: number;
  onChange: (i: number) => void;
  columns: string[];
  indices: number[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="max-w-[12rem] rounded-md border bg-background px-2 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {indices.map((i) => (
          <option key={i} value={i}>
            {humanizeLabel(columns[i])}
          </option>
        ))}
      </select>
    </label>
  );
}
