"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Check, ChevronDown, CircleSlash, ExternalLink, Loader2, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarHeader } from "@/components/query/sidebar-header";
import { formatDuration } from "@/lib/format";
import { SETUP_FACTS } from "@/lib/pipeline-info";
import type { QueryResultObject } from "@/lib/query-schema";

/** The latest turn the trace reflects — streaming object or a frozen snapshot. */
export interface TraceTarget {
  question: string;
  kind: "nl" | "sql";
  src: QueryResultObject | null | undefined;
  loading: boolean;
}

type StageStatus = "pending" | "running" | "done" | "failed" | "skipped" | "refused";

/**
 * Deep link into the Raindrop dashboard's events table. The `event` param opens
 * the detail panel; the timestamp filter mirrors what the app puts in its own
 * URLs — a range that includes "now" — so the table behind the panel isn't
 * scoped to some default window that excludes the event. Trailing 30 days is a
 * comfortable superset for anything surfaced live in this sidebar.
 */
function raindropEventUrl(eventId: string): string {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const tableFilters = JSON.stringify([
    { field: "timestamp", value: { from: from.toISOString(), to: now.toISOString() } },
  ]);
  const tableSorting = JSON.stringify([{ field: "timestamp", direction: "desc" }]);
  const params = new URLSearchParams({ tableFilters, tableSorting, event: eventId });
  return `https://app.raindrop.ai/events?${params}`;
}

const STATUS_ICON: Record<StageStatus, typeof Check> = {
  pending: Minus,
  running: Loader2,
  done: Check,
  failed: AlertTriangle,
  skipped: Minus,
  refused: CircleSlash,
};

const STATUS_STYLE: Record<StageStatus, string> = {
  pending: "border-border/60 bg-background text-muted-foreground/50",
  running: "border-primary/40 bg-primary/10 text-primary",
  done: "border-success-600/40 bg-success-600/10 text-success-600 dark:text-success-300",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  skipped: "border-border/60 bg-background text-muted-foreground/40",
  refused: "border-warning-600/40 bg-warning-600/10 text-warning-700 dark:text-warning-200",
};

function Stage({
  status,
  label,
  meta,
  last,
}: {
  status: StageStatus;
  label: string;
  /** Small metric chips beneath the stage label. */
  meta?: string[];
  last?: boolean;
}) {
  const Icon = STATUS_ICON[status];
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            STATUS_STYLE[status],
          )}
        >
          <Icon aria-hidden className={cn("h-3 w-3", status === "running" && "animate-spin")} />
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-border/60" />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-4")}>
        <p
          className={cn(
            "text-xs font-medium",
            status === "pending" || status === "skipped" ? "text-muted-foreground/60" : "text-foreground",
          )}
        >
          {label}
        </p>
        {meta && meta.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-x-1.5">
                {i > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** A collapsible drilldown. Closed by default so the panel stays scannable. */
function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** A one-glance value shown on the right of the closed header. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform", !open && "-rotate-90")}
        />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {title}
        </span>
        {summary && !open && (
          <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground/80">{summary}</span>
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-0.5">{children}</div>}
    </div>
  );
}

/** Derive each pipeline stage's status from the (possibly partial) result object. */
function deriveStages(target: TraceTarget) {
  const { src, loading, kind } = target;
  const hasSql = Boolean(src?.sql);
  const outOfScope = Boolean(src?.outOfScope);
  const isError = Boolean(src?.error);
  const errorKind = src?.errorKind;
  const hasResult = src?.executionMs != null;
  // An edited-SQL turn skips generation entirely (it runs /api/execute).
  const generated = kind === "nl";

  // Decode (generation) stage.
  const decodeFailedBeforeSql =
    isError && !hasSql && (errorKind === "generation_failed" || errorKind === "request_failed");
  const decode: StageStatus = !generated
    ? "skipped"
    : outOfScope
      ? "refused"
      : decodeFailedBeforeSql
        ? "failed"
        : hasSql
          ? "done"
          : loading
            ? "running"
            : "pending";

  // Execution stage.
  const exec: StageStatus = outOfScope
    ? "skipped"
    : hasResult
      ? "done"
      : errorKind === "execution_failed"
        ? "failed"
        : hasSql
          ? loading
            ? "running"
            : isError
              ? "skipped"
              : "pending"
          : "pending";

  return { decode, exec };
}

/**
 * Right sidebar that exposes the backend trace + setup behind the current answer.
 * The live generation → execution pipeline stays visible as the summary (with its
 * key timings/tokens inline on each stage); the heavier detail — token split,
 * generated SQL, and the static route configuration — folds into collapsible
 * drilldowns so the panel reads at a glance rather than dumping everything at once.
 * The `target` is the latest turn (streaming or frozen); without one, only the
 * Setup drilldown shows.
 */
export function TracePanel({ target }: { target: TraceTarget | null }) {
  const src = target?.src;
  const usage = src?.usage;
  const rowCount = Array.isArray(src?.rows) ? src!.rows!.length : undefined;
  const colCount = Array.isArray(src?.columns) ? src!.columns!.length : undefined;
  const stages = target ? deriveStages(target) : null;

  const decodeMeta: string[] = [];
  if (src?.cached) decodeMeta.push("cached");
  if (typeof src?.generationMs === "number") decodeMeta.push(formatDuration(src.generationMs));
  if (usage) decodeMeta.push(`${usage.totalTokens.toLocaleString()} tok`);

  const execMeta: string[] = [];
  if (typeof src?.executionMs === "number") execMeta.push(formatDuration(src.executionMs));
  if (typeof rowCount === "number" && typeof colCount === "number")
    execMeta.push(`${rowCount.toLocaleString()} × ${colCount}`);

  return (
    <>
      <SidebarHeader
        title="Trace"
        subtitle={
          target
            ? "Live pipeline for the latest answer."
            : "Run a query to see how its answer is produced."
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {target && stages ? (
          <>
            {/* Pipeline stepper — the always-visible summary. */}
            <ol className="list-none px-4 pb-3 pt-4">
              <Stage
                status="done"
                label={target.kind === "sql" ? "Edited SQL submitted" : "Question received"}
              />
              <Stage
                status={stages.decode}
                label={
                  target.kind === "sql"
                    ? "Generation skipped (edited)"
                    : stages.decode === "refused"
                      ? "Model declined (cannot_answer)"
                      : "Grammar-constrained decode"
                }
                meta={decodeMeta}
              />
              <Stage status={stages.exec} label="ClickHouse execution" meta={execMeta} last />
            </ol>

            {/* Refusal / error stay inline — they're the outcome, not a drilldown. */}
            {src?.outOfScope && src?.refusalReason && (
              <div className="mx-4 mb-4 rounded-lg border border-warning-600/30 bg-warning-600/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
                {src.refusalReason}
              </div>
            )}
            {src?.error && (
              <div className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-mono text-destructive">{src.errorKind ?? "error"}</span>
                <span className="mx-1.5 text-muted-foreground/40">·</span>
                {src.error}
              </div>
            )}

            {usage && (
              <Section title="Token usage" summary={`${usage.totalTokens.toLocaleString()} tok`}>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { k: "input", v: usage.inputTokens },
                    { k: "output", v: usage.outputTokens },
                    { k: "total", v: usage.totalTokens },
                  ].map((t) => (
                    <div key={t.k} className="rounded-lg border bg-card/60 px-1 py-2.5">
                      <dd className="font-mono text-sm tabular-nums text-foreground">{t.v.toLocaleString()}</dd>
                      <dt className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">{t.k}</dt>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            {src?.sql && (
              <Section title={target.kind === "sql" ? "Submitted SQL" : "Generated SQL"}>
                <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                  {src.sql}
                </pre>
              </Section>
            )}

            {src?.eventId && (
              <Section title="Trace event" summary={src.eventId.slice(0, 8)}>
                <a
                  href={raindropEventUrl(src.eventId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in the observability dashboard"
                  className="group flex items-start gap-1.5 break-all font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 underline decoration-border underline-offset-2 group-hover:decoration-foreground/40">
                    {src.eventId}
                  </span>
                  <ExternalLink aria-hidden className="mt-px h-3 w-3 shrink-0 text-muted-foreground/50 group-hover:text-foreground" />
                </a>
              </Section>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <Activity aria-hidden className="h-6 w-6 text-muted-foreground/40" />
            <p className="mt-2 text-xs text-muted-foreground">
              Ask a question and its trace shows up here: each step from generation to execution,
              how long each took, what it cost in tokens, and the exact SQL that ran — so you can
              see how an answer was produced, not just what it was.
            </p>
          </div>
        )}

        {/* Static configuration — collapsed by default; the value-only rows keep
            it scannable, with the longer explanation one hover away. */}
        <Section title="Setup">
          <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
            The fixed configuration behind every query — hover a row for what it means.
          </p>
          <dl className="space-y-2.5">
            {SETUP_FACTS.map((f) => (
              <div
                key={f.label}
                className={cn("flex items-baseline justify-between gap-3", f.hint && "cursor-help")}
                title={f.hint}
              >
                <dt
                  className={cn(
                    "shrink-0 text-[11px] text-muted-foreground/70",
                    f.hint && "underline decoration-border decoration-dotted underline-offset-2",
                  )}
                >
                  {f.label}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 truncate text-right text-[11px] text-foreground",
                    f.mono && "font-mono",
                  )}
                >
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </>
  );
}
