"use client";

import { useState } from "react";
import { Check, ChevronRight, CircleSlash, Copy, RotateCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { highlightSQL } from "@/lib/sql-highlight";
import { ResultTable } from "@/components/query/result-table";
import { labelledChecks, type EvalTrialResult } from "@/lib/eval-run";
import { CheckPill, ModeTag } from "@/components/evals/status";
import { formatDuration } from "@/lib/format";
import type { TrialState } from "@/lib/use-eval-runner";

/**
 * The expanded view of one trial: what the model emitted, what it cost, how
 * each grading axis judged it, and the result set next to the live reference
 * answer (a fresh ClickHouse run of the case's reference SQL, executed for
 * this trial). Rendered for both modes side-by-side inside an expanded case row.
 */
export function TrialDetail({
  trial,
  state,
  onRerun,
  busy,
}: {
  trial?: EvalTrialResult;
  state: TrialState;
  onRerun: () => void;
  busy: boolean;
}) {
  const running = state.status === "running" || state.status === "queued";

  if (!trial) {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
        {running ? "Running…" : state.status === "error" ? (state.error ?? "Request failed") : "Not run yet."}
      </div>
    );
  }

  const checks = trial.suite === "labelled" ? labelledChecks(trial) : null;

  return (
    <div className="space-y-3">
      {/* Header: mode + cost line + re-run */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <ModeTag mode={trial.mode} />
          {trial.generationMs != null && (
            <span className="font-mono" title="Wall-clock time for the model to emit SQL (or decline)">
              {formatDuration(trial.generationMs)} gen
            </span>
          )}
          {trial.executionMs != null && (
            <span className="font-mono" title="Wall-clock time for ClickHouse to run the query">
              {formatDuration(trial.executionMs)} exec
            </span>
          )}
          {trial.usage && (
            <span
              className="font-mono"
              title={`${trial.usage.inputTokens.toLocaleString()} in + ${trial.usage.outputTokens.toLocaleString()} out`}
            >
              {trial.usage.totalTokens.toLocaleString()} tok
            </span>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRerun} disabled={busy}>
          <RotateCw aria-hidden className={cn("h-3 w-3", running && "animate-spin")} />
          Run again
        </Button>
      </div>

      {/* Generation outcome */}
      {trial.refused ? (
        <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/50 p-3 text-xs">
          <CircleSlash aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-700 dark:text-warning-200" />
          <div>
            <p className="font-medium">Declined via cannot_answer</p>
            <p className="mt-0.5 text-muted-foreground">{trial.refusalReason}</p>
          </div>
        </div>
      ) : trial.generationError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Generation failed</p>
            <p className="mt-0.5 break-words text-muted-foreground">{trial.generationError}</p>
          </div>
        </div>
      ) : trial.sql ? (
        <SqlSnippet sql={trial.sql} />
      ) : null}

      {/* Grading axes (labelled cases) */}
      {checks && (
        <ul className="space-y-1 text-xs">
          <CheckRow
            pill={<CheckPill label="exec" state={checks.exec} />}
            text={
              trial.executed
                ? "Executed on ClickHouse"
                : (trial.executionError ?? (trial.refused ? "Declined an answerable question — nothing executed" : "Never executed"))
            }
            fail={checks.exec === "fail"}
          />
          <CheckRow
            pill={<CheckPill label="answer" state={checks.answer} />}
            text={
              trial.correct
                ? "Result matches the live reference answer"
                : trial.executed
                  ? "Result differs from the live reference answer"
                  : "No result to compare"
            }
            fail={checks.answer === "fail"}
          />
          <CheckRow
            pill={<CheckPill label="schema" state={checks.schema} />}
            text={
              (trial.violations?.length ?? 0) === 0
                ? "Every identifier is in the schema whitelist"
                : `Outside the schema whitelist: ${trial.violations!.map((v) => v.token).join(", ")}`
            }
            fail={checks.schema === "fail"}
          />
        </ul>
      )}

      {/* Out-of-scope fabrication detail */}
      {trial.suite === "oos" && trial.sql && (
        <p className="text-xs text-muted-foreground">
          {(trial.violations?.length ?? 0) > 0 ? (
            <>
              Answered with identifiers outside the schema whitelist:{" "}
              <span className="font-mono text-danger-800 dark:text-danger-200">
                {trial.violations!.map((v) => v.token).join(", ")}
              </span>
            </>
          ) : (
            "Answered instead of declining (every identifier is whitelisted — the query is degenerate, not off-schema)."
          )}
          {trial.executionError && <span className="mt-1 block break-words">ClickHouse: {trial.executionError}</span>}
        </p>
      )}
      {/* Result vs the live reference answer */}
      {trial.executed && trial.columns && trial.rows && (
        <Disclosure
          label={`Model result · ${trial.rows.length.toLocaleString()} row${trial.rows.length === 1 ? "" : "s"}${trial.rowsTruncated ? " (truncated)" : ""}`}
          defaultOpen={trial.rows.length <= 6}
        >
          <ResultTable columns={trial.columns} rows={trial.rows} />
        </Disclosure>
      )}
      {trial.expected && (
        <Disclosure
          label={`Reference answer (live) · ${trial.expected.rows.length.toLocaleString()} row${trial.expected.rows.length === 1 ? "" : "s"}${trial.expectedTruncated ? " (truncated)" : ""}`}
        >
          <ResultTable columns={trial.expected.columns} rows={trial.expected.rows} />
        </Disclosure>
      )}
    </div>
  );
}

function CheckRow({ pill, text, fail }: { pill: React.ReactNode; text: string; fail: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-px shrink-0">{pill}</span>
      <span className={cn("min-w-0 break-words", fail ? "text-foreground" : "text-muted-foreground")}>{text}</span>
    </li>
  );
}

/** Read-only SQL block with a copy affordance (no edit/re-run — that's /query's job). */
function SqlSnippet({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked — fail quietly.
    }
  }
  return (
    <div className="group relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute right-1.5 top-1.5 z-10 h-6 w-6 bg-card/80 backdrop-blur-sm"
        aria-label={copied ? "Copied" : "Copy SQL"}
        title={copied ? "Copied!" : "Copy"}
        onClick={copy}
      >
        {copied ? (
          <Check aria-hidden className="h-3 w-3 text-success-600 dark:text-success-300" />
        ) : (
          <Copy aria-hidden className="h-3 w-3" />
        )}
      </Button>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-card/50 p-2.5 pr-10 font-mono text-[11px] leading-relaxed">
        <code>{highlightSQL(sql)}</code>
      </pre>
    </div>
  );
}

/** Native-details disclosure, styled to match the card language. */
function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-lg border border-border/50 bg-card/50" open={defaultOpen}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="px-2.5 pb-2.5">{children}</div>
    </details>
  );
}
