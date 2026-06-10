"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckState } from "@/lib/eval-run";
import type { TrialStatus } from "@/lib/use-eval-runner";

/**
 * Small shared vocabulary for the eval runner: one glyph for a trial's
 * lifecycle (idle → queued → running → pass/fail/error), and one pill per
 * grading axis (exec / answer / schema). Used by every row type so
 * the whole page reads consistently.
 */

export function StatusGlyph({
  status,
  pass,
  className,
}: {
  status: TrialStatus;
  /** Verdict, once status is "done". */
  pass?: boolean;
  className?: string;
}) {
  const base = cn("h-4 w-4 shrink-0", className);
  switch (status) {
    case "queued":
      return <Clock3 aria-hidden className={cn(base, "text-muted-foreground/60")} />;
    case "running":
      return <Loader2 aria-hidden className={cn(base, "animate-spin text-primary")} />;
    case "error":
      return <AlertTriangle aria-hidden className={cn(base, "text-warning-700 dark:text-warning-200")} />;
    case "done":
      return pass ? (
        <CheckCircle2 aria-hidden className={cn(base, "text-success-600 dark:text-success-300")} />
      ) : (
        <XCircle aria-hidden className={cn(base, "text-destructive")} />
      );
    default:
      return <CircleDashed aria-hidden className={cn(base, "text-muted-foreground/40")} />;
  }
}

/** Screen-reader text for a trial's state, paired with StatusGlyph. */
export function statusLabel(status: TrialStatus, pass?: boolean): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "error":
      return "request failed";
    case "done":
      return pass ? "passed" : "failed";
    default:
      return "not run yet";
  }
}

const CHECK_STYLES: Record<CheckState, string> = {
  pass: "bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-200",
  fail: "bg-danger-100 text-danger-800 dark:bg-danger-900 dark:text-danger-200",
  na: "bg-muted text-muted-foreground/70",
};

export function CheckPill({
  label,
  state,
  hint,
}: {
  label: string;
  state: CheckState;
  hint?: string;
}) {
  return (
    <span
      title={hint}
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none",
        CHECK_STYLES[state],
      )}
    >
      {label}
      <span className="sr-only">: {state === "na" ? "not applicable" : state}</span>
      <span aria-hidden>{state === "pass" ? "✓" : state === "fail" ? "✗" : "–"}</span>
    </span>
  );
}

/**
 * Gloss for the CFG / no CFG shorthand, surfaced as a tooltip wherever the
 * label appears — the acronym is otherwise only defined in eval 5's prose.
 */
export const MODE_HINT: Record<"constrained" | "unconstrained", string> = {
  constrained:
    "CFG = context-free grammar. Decoding is constrained so the model can only emit SQL the grammar allows.",
  unconstrained: "Same model and prompt with no grammar constraint — the free-form baseline.",
};

/** Mode tag: the grammar-constrained path vs the unconstrained baseline. */
export function ModeTag({ mode }: { mode: "constrained" | "unconstrained" }) {
  return (
    <span
      title={MODE_HINT[mode]}
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-wide",
        mode === "constrained" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {mode === "constrained" ? "CFG" : "no CFG"}
    </span>
  );
}
