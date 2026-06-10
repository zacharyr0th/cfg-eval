"use client";

import { CircleSlash, Database, Loader2, RotateCw, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanizeDatesInText } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SqlBlock } from "@/components/query/sql-block";
import { ResultView } from "@/components/query/result-view";
import type { QueryResultObject } from "@/lib/query-schema";
import type { QueryResult } from "@/lib/query-types";

/** Human-readable titles for the error-kind enum the route/API emits, so the
 *  alert headline reads as guidance rather than an internal code. */
function errorTitle(kind?: string): string {
  switch (kind) {
    case "request_failed":
    case "generation_failed":
      return "Couldn't generate SQL";
    case "network":
      return "Couldn't reach the server";
    case "bad_request":
      return "Invalid request";
    case "unsafe_sql":
      return "Query blocked for safety";
    case "rate_limited":
      return "Too many requests";
    case "execution_failed":
      return "ClickHouse couldn't run that query";
    case "missing_clickhouse_config":
      return "Database isn't configured";
    case "missing_openai_key":
      return "Model isn't configured";
    default:
      return "Something went wrong";
  }
}

export interface ChatTurnProps {
  /** What the user "said" — an NL question, or the SQL text for an edited re-run. */
  question: string;
  kind: "nl" | "sql";
  /** Live (streaming) object for the active turn, or the frozen snapshot for past turns. */
  src: QueryResultObject | null | undefined;
  /** Is *this* turn still in flight. */
  loading: boolean;
  onRerun: (sql: string) => void;
  /** Error affordances — only wired for settled (frozen) turns. */
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * One question→answer exchange rendered as a chat turn: a right-aligned user
 * bubble, then the assistant's reply (generated SQL + result table, or an
 * error). The same component renders the live streaming turn and every frozen
 * turn in the transcript — the only difference is whether `src` is the live
 * `useObject` value or a snapshot, and whether `loading` is set.
 */
export function ChatTurn({ question, kind, src, loading, onRerun, onRetry, onDismiss }: ChatTurnProps) {
  const sql = src?.sql;
  const rows = src?.rows as unknown[][] | undefined;
  const columns = src?.columns as string[] | undefined;
  const errorMessage = src?.error;
  const errorKind = src?.errorKind;
  const isError = Boolean(errorMessage);
  const outOfScope = Boolean(src?.outOfScope);
  const refusalReason = src?.refusalReason;
  const hasResult = src?.executionMs != null && Array.isArray(rows) && Array.isArray(columns);

  const result: QueryResult | null = sql
    ? {
        sql,
        columns: columns ?? [],
        rows: rows ?? [],
        executionMs: src?.executionMs,
        model: src?.model,
        generationMs: src?.generationMs,
        usage: src?.usage,
        cached: src?.cached,
        edited: kind === "sql",
      }
    : null;

  return (
    <div className="space-y-4">
      {/* User message */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground shadow-[var(--shadow-sm)]">
          {kind === "sql" && (
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
              Edited SQL
            </p>
          )}
          {/* NL questions get display-only date prettifying ("2015-08-15" → "Aug 15, 2015");
              SQL is shown verbatim — rewriting dates inside code would misquote it. */}
          <p className={cn("whitespace-pre-wrap break-words", kind === "sql" ? "font-mono text-xs leading-relaxed" : "text-sm")}>
            {kind === "nl" ? humanizeDatesInText(question) : question}
          </p>
        </div>
      </div>

      {/* Assistant reply */}
      <div className="flex gap-3">
        <Avatar />
        <div className="min-w-0 flex-1 space-y-3">
          {/* Decode in flight, no SQL streamed yet (NL turns only). */}
          {kind === "nl" && loading && !sql && !isError && (
            <div className="flex items-center gap-2.5 pt-1.5 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
              Generating grammar-constrained SQL…
            </div>
          )}

          {result && <SqlBlock result={result} running={loading} onRerun={onRerun} />}

          {!isError &&
            result &&
            (hasResult ? (
              <ResultView columns={columns ?? []} rows={rows ?? []} question={kind === "nl" ? question : undefined} />
            ) : (
              loading && (
                <div className="flex items-center gap-2.5 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                  <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
                  Running on ClickHouse…
                </div>
              )
            ))}

          {isError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{errorTitle(errorKind)}</p>
                <p className="mt-1 text-muted-foreground">{errorMessage}</p>
                {(onRetry || onDismiss) && (
                  <div className="mt-3 flex items-center gap-2">
                    {onRetry && (
                      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                        <RotateCw aria-hidden className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                    {onDismiss && (
                      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
                        <X aria-hidden className="h-3.5 w-3.5" />
                        Dismiss
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Out of scope: the model declined via cannot_answer. Distinct from an
              error (nothing failed) and from a result (no number to trust). */}
          {outOfScope && !loading && (
            <div role="note" className="rounded-2xl border bg-card p-4 text-sm shadow-[var(--shadow-sm)]">
              <div className="flex items-start gap-3">
                <CircleSlash aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-200" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Out of scope for this dataset</p>
                  <p className="mt-1 text-muted-foreground">
                    {refusalReason ?? "This question can't be answered from the nyc_taxi columns."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground/80">
                    The model declined instead of forcing a query — no SQL was run. nyc_taxi only covers
                    trip-level fields (times, distance, fares, payment type, pickup/dropoff neighborhoods)
                    for July–September 2015.
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

/** The assistant's avatar — a database glyph, since every reply is a SQL run. */
export function Avatar({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
        className,
      )}
    >
      <Database className={cn("h-4 w-4", iconClassName)} />
    </span>
  );
}
