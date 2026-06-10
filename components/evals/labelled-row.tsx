"use client";

import { useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { labelledChecks, labelledPass, type EvalMode, type EvalTrialResult } from "@/lib/eval-run";
import { humanDateLabels } from "@/lib/format";
import { MODE_HINT, StatusGlyph, statusLabel } from "@/components/evals/status";
import { TrialDetail } from "@/components/evals/trial-detail";
import type { TrialState } from "@/lib/use-eval-runner";
import type { EvalCase, Difficulty } from "@/tests/eval-cases";

const TIER_DOT: Record<Difficulty, string> = {
  easy: "bg-success-600/70 dark:bg-success-300",
  medium: "bg-info-600/70 dark:bg-info-300",
  hard: "bg-warning-600/80 dark:bg-warning-300",
};

/** One-word verdict for the collapsed cell — names the first failing axis. */
function headline(state: TrialState): string {
  // A transport error always surfaces, even when an older sample exists —
  // silently showing the stale verdict would misreport the latest attempt.
  if (state.status === "error") return "request failed";
  const t = state.runs[state.runs.length - 1];
  if (!t) {
    return state.status === "running" ? "running…" : state.status === "queued" ? "queued" : "—";
  }
  if (t.refused) return "declined";
  if (t.generationError) return "no SQL";
  const c = labelledChecks(t);
  if (c.exec === "fail") return "didn't execute";
  if (c.schema === "fail") return "off-schema";
  if (c.answer === "fail") return "wrong answer";
  return "pass";
}

function ModeCell({ label, hint, state }: { label: string; hint: string; state: TrialState }) {
  const latest: EvalTrialResult | undefined = state.runs[state.runs.length - 1];
  const pass = state.status === "error" ? undefined : latest ? labelledPass(latest) : undefined;
  const idle = state.status === "idle" && !latest;
  const glyphStatus =
    state.status === "running" || state.status === "queued" || state.status === "error"
      ? state.status
      : latest
        ? "done"
        : state.status;
  return (
    <div className={cn("flex w-24 shrink-0 items-center gap-1.5 text-xs", idle && "opacity-40")}>
      <span className="sr-only">{label}:</span>
      <StatusGlyph status={glyphStatus} pass={pass} />
      {/* Idle cells stay glyph-only — 32 rows of placeholder text reads as noise. */}
      {!idle && (
        <span
          className={cn(
            "line-clamp-2 leading-tight",
            pass === false ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {headline(state)}
        </span>
      )}
      <span className="sr-only">{statusLabel(state.status, pass)}</span>
    </div>
  );
}

export function LabelledRow({
  case: c,
  cfg,
  baseline,
  onRun,
  onRunMode,
}: {
  case: EvalCase;
  cfg: TrialState;
  baseline: TrialState;
  onRun: () => void;
  onRunMode: (mode: EvalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const inFlight = [cfg.status, baseline.status].some((s) => s === "queued" || s === "running");
  const hasRuns = cfg.runs.length > 0 || baseline.runs.length > 0;
  const dateLabels = humanDateLabels(c.question);

  return (
    <div>
      {/* Whole row toggles the detail drawer; clicks on the inner buttons
          (question toggle, run) are theirs — closest('button') filters them. */}
      <div
        className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-nowrap"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          setOpen((o) => !o);
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 basis-64 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-90")}
          />
          <span className="min-w-0">
            <span className="text-sm leading-snug sm:line-clamp-2" title={c.question}>
              {c.question}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TIER_DOT[c.difficulty])} />
                {c.difficulty}
              </span>
              {/* The ISO date in the prompt is a fixture the model is graded on
                  parsing, so it stays verbatim above; this is the human gloss. */}
              {dateLabels.length > 0 && <span>{dateLabels.join(" – ")}</span>}
            </span>
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <ModeCell label="CFG" hint={MODE_HINT.constrained} state={cfg} />
          <ModeCell label="no CFG" hint={MODE_HINT.unconstrained} state={baseline} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onRun}
            disabled={inFlight}
            title={hasRuns ? "Re-run both modes" : "Run both modes"}
            aria-label={`Run case ${c.id} in both modes`}
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t bg-muted/20 px-4 py-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <TrialDetail
              trial={cfg.runs[cfg.runs.length - 1]}
              state={cfg}
              onRerun={() => onRunMode("constrained")}
              busy={cfg.status === "running" || cfg.status === "queued"}
            />
            <TrialDetail
              trial={baseline.runs[baseline.runs.length - 1]}
              state={baseline}
              onRerun={() => onRunMode("unconstrained")}
              busy={baseline.status === "running" || baseline.status === "queued"}
            />
          </div>
          <p className="mt-3 break-words font-mono text-[10px] leading-relaxed text-muted-foreground/60">
            <span className="font-sans font-medium uppercase tracking-wide">Case:</span> {c.id}
            <span className="mx-2 font-sans" aria-hidden>
              ·
            </span>
            <span className="font-sans font-medium uppercase tracking-wide">Reference:</span> {c.referenceSQL}
          </p>
        </div>
      )}
    </div>
  );
}
