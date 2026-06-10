"use client";

import { useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { EvalMode, EvalTrialResult } from "@/lib/eval-run";
import { humanDateLabels } from "@/lib/format";
import { MODE_HINT, StatusGlyph } from "@/components/evals/status";
import { TrialDetail } from "@/components/evals/trial-detail";
import type { TrialState } from "@/lib/use-eval-runner";
import type { OutOfScopeCase } from "@/tests/out-of-scope-cases";

/**
 * One unanswerable prompt. Pass = the model declined (cannot_answer) instead
 * of fabricating an answer. The baseline column is the foil: with no abstain
 * tool and no grammar, it shows what fabrication actually looks like.
 */

function headline(state: TrialState): { text: string; pass?: boolean } {
  // A transport error always surfaces, even when an older sample exists —
  // silently showing the stale verdict would misreport the latest attempt.
  if (state.status === "error") return { text: "request failed" };
  const t: EvalTrialResult | undefined = state.runs[state.runs.length - 1];
  if (!t) {
    return { text: state.status === "running" ? "running…" : state.status === "queued" ? "queued" : "—" };
  }
  if (t.refused) return { text: "declined", pass: true };
  if (t.generationError) return { text: "no output", pass: false };
  const offSchema = (t.violations?.length ?? 0) > 0;
  return { text: offSchema ? "off-schema SQL" : "answered anyway", pass: false };
}

function ModeCell({ label, hint, state }: { label: string; hint: string; state: TrialState }) {
  const latest = state.runs[state.runs.length - 1];
  const h = headline(state);
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
      <StatusGlyph status={glyphStatus} pass={h.pass} />
      {/* Idle cells stay glyph-only — 32 rows of placeholder text reads as noise. */}
      {!idle && (
        <span
          className={cn(
            "line-clamp-2 leading-tight",
            h.pass === false ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {h.text}
        </span>
      )}
      <span className="sr-only">{idle ? "not run yet" : undefined}</span>
    </div>
  );
}

export function OosRow({
  case: c,
  cfg,
  baseline,
  onRun,
  onRunMode,
}: {
  case: OutOfScopeCase;
  cfg: TrialState;
  baseline: TrialState;
  onRun: () => void;
  onRunMode: (mode: EvalMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const inFlight = [cfg.status, baseline.status].some((s) => s === "queued" || s === "running");
  const hasRuns = cfg.runs.length > 0 || baseline.runs.length > 0;

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
            <span className="mt-1 text-[11px] text-muted-foreground sm:line-clamp-2">
              {c.reason}
              {/* Human gloss for any ISO date in the prompt; the prompt itself
                  is a graded fixture and stays verbatim. */}
              {humanDateLabels(c.question).length > 0 && <> · {humanDateLabels(c.question).join(" – ")}</>}
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
            aria-label={`Run out-of-scope case ${c.id} in both modes`}
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
        </div>
      )}
    </div>
  );
}
