"use client";

import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MODE_HINT } from "@/components/evals/status";
import { formatDuration } from "@/lib/format";
import type { EvalSummary, ModeSummary } from "@/lib/eval-summary";

/**
 * The money chart, live: the same CFG vs no-CFG comparison eval 5 prints as a
 * console.table, fed by whatever trials have run in this session. Bars fill
 * in as results stream back, so the gap between the constrained path and the
 * baseline is visible while the suite is still running.
 */

/**
 * Render a rate without flattering it: floor to one decimal so 199/200 shows
 * "99.5%", never "100%" — only a true 1.0 earns the round number, and only a
 * true 0 shows "0%".
 */
function pct(v: number | null): string {
  if (v === null) return "—";
  if (v === 1) return "100%";
  if (v === 0) return "0%";
  const floored = Math.floor(v * 1000) / 10;
  if (floored === 0) return "<0.1%";
  return `${floored % 1 === 0 ? floored.toFixed(0) : floored.toFixed(1)}%`;
}

function Bar({ value, tone }: { value: number | null; tone: "cfg" | "base" }) {
  // A true 0 renders as an empty track — no fill at all. The old 2% sliver
  // read as a rendering glitch rather than a meaningful zero; the adjacent
  // "0%" label (vs "—" for not-run) carries the distinction. Tiny non-zero
  // values still get the 2% floor so they stay visible.
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
      {value !== null && value > 0 && (
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone === "cfg" ? "bg-primary" : "bg-foreground/30")}
          style={{ width: `${Math.max(2, value * 100)}%` }}
        />
      )}
    </div>
  );
}

function MetricRow({
  label,
  hint,
  cfg,
  base,
}: {
  label: string;
  hint: string;
  cfg: number | null;
  base: number | null;
}) {
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
      </div>
      <div className="mt-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary">cfg</span>
          <Bar value={cfg} tone="cfg" />
          <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums">{pct(cfg)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">no cfg</span>
          <Bar value={base} tone="base" />
          <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
            {pct(base)}
          </span>
        </div>
      </div>
    </div>
  );
}

const TIER_VARIANT = { easy: "success", medium: "info", hard: "warning" } as const;

export function Scoreboard({ summary }: { summary: EvalSummary }) {
  const cfg: ModeSummary = summary.modes.constrained;
  const base: ModeSummary = summary.modes.unconstrained;
  const empty = summary.slotsDone === 0;

  const allSlotsDone = summary.slotsDone === summary.totalSlots && summary.totalSlots > 0;
  // The CONSTRAINED path's contract — every query ran, stayed in-schema, matched
  // (where graded), and declined every out-of-scope prompt. This is deliberately
  // NOT "all 62 trials passed": the no-CFG baseline is the foil and is expected
  // to drift and answer anyway, so claiming it passed would be dishonest.
  const cfgHeldContract =
    allSlotsDone &&
    cfg.execRate === 1 &&
    cfg.schemaCleanRate === 1 &&
    cfg.answerRate === 1 &&
    cfg.oosRun > 0 &&
    cfg.oosDeclined === cfg.oosRun;

  return (
    <section aria-label="Eval scoreboard" className="rounded-xl border border-border/50 bg-card/60 p-3 shadow-[var(--shadow-sm)] backdrop-blur-md md:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          <abbr title={MODE_HINT.constrained} className="cursor-help no-underline">
            CFG
          </abbr>{" "}
          vs no-CFG, live
        </h2>
        <p
          title="Average model generation latency per query, by mode"
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {summary.slotsDone}/{summary.totalSlots} trials
          {cfg.avgGenMs !== null && <> · latency: cfg {formatDuration(cfg.avgGenMs)}</>}
          {base.avgGenMs !== null && <> · no-cfg {formatDuration(base.avgGenMs)}</>}
        </p>
      </div>

      {cfgHeldContract && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong className="font-semibold">CFG held its contract</strong> across all {summary.totalSlots / 2}{" "}
            constrained trials — every query executed in-schema and every out-of-scope prompt was declined. The
            no-CFG baseline is the foil; it&apos;s expected to drift and answer anyway.
          </span>
        </div>
      )}

      {empty && (
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing has run yet — hit <span className="font-medium text-foreground">Run all</span> (or any row) and
          this fills in as results land.
        </p>
      )}

      <div className="mt-3 space-y-2.5">
        <MetricRow
          label="Executes on ClickHouse"
          hint="Eval 2 — share of generated queries ClickHouse ran without error"
          cfg={cfg.execRate}
          base={base.execRate}
        />
        <MetricRow
          label="Schema-grounded SQL"
          hint="Eval 3 — queries referencing only real columns and functions"
          cfg={cfg.schemaCleanRate}
          base={base.schemaCleanRate}
        />
        <MetricRow
          label="Matches the reference answer"
          hint="Eval 1 — result set equals a live ClickHouse run of the case's reference SQL, fetched fresh per trial"
          cfg={cfg.answerRate}
          base={base.answerRate}
        />
        <MetricRow
          label="Declines out-of-scope questions"
          hint="Eval 4 — unanswerable prompts declined instead of answered (latest run per case)"
          cfg={cfg.oosRun ? cfg.oosDeclined / cfg.oosRun : null}
          base={base.oosRun ? base.oosDeclined / base.oosRun : null}
        />

        {/* The discriminating slice. Clean prompts saturate both modes; these
            two metrics are where the grammar actually separates from the base
            model — answerable prompts engineered to tempt schema drift, and the
            phantom-column out-of-scope prompts the baseline fabricates. */}
        <div className="rounded-lg border border-primary/25 bg-primary/[0.03] p-2.5">
          <p className="text-[11px] font-medium text-primary/80">Where constraints matter most</p>
          {(summary.headline.modes.constrained.run > 0 ||
            summary.headline.modes.unconstrained.run > 0) && (
            <p
              title={`Case-level verdict over the ${summary.headline.n} prompts built to break the baseline (adversarial + phantom-column). A case fails when any run drifts off schema or doesn't execute (adversarial), or when an unanswerable prompt gets answered (phantom).`}
              className="mt-1 cursor-help font-mono text-[11px] tabular-nums text-foreground/80"
            >
              no CFG failed {summary.headline.modes.unconstrained.failed}/
              {summary.headline.modes.unconstrained.run} · CFG failed{" "}
              {summary.headline.modes.constrained.failed}/{summary.headline.modes.constrained.run}
            </p>
          )}
          <div className="mt-2 space-y-2.5">
            <MetricRow
              label="Adversarial prompts — correct answer"
              hint="Correctness on the gradable adversarial prompts (avg-of-ratios). Duration/speed are excluded here — they have no canonical answer, so they're judged on grounding only. CFG doesn't structurally help correctness; this is expected to stay level."
              cfg={cfg.advAnswerRate}
              base={base.advAnswerRate}
            />
            <MetricRow
              label="Adversarial prompts — schema-grounded"
              hint="The discriminating axis: share of outputs referencing only real columns/functions across the whole adversarial slice. CFG is 1.0 by construction; the baseline reaches for dateDiff() and invented duration/speed columns."
              cfg={cfg.advSchemaCleanRate}
              base={base.advSchemaCleanRate}
            />
            <MetricRow
              label="Phantom columns — declined, not answered"
              hint="Out-of-scope prompts naming real NYC-TLC fields absent here (mta_tax, VendorID, …). CFG declines via cannot_answer; the baseline answers anyway with a degenerate confident query (SELECT 0, WHERE 1=0) — a wrong number, not a refusal."
              cfg={cfg.oosPhantomRun ? cfg.oosPhantomDeclined / cfg.oosPhantomRun : null}
              base={base.oosPhantomRun ? base.oosPhantomDeclined / base.oosPhantomRun : null}
            />
          </div>
        </div>

        {/* Tier breakdown, constrained path */}
        <div className="rounded-lg border border-border/50 bg-background/30 p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Constrained correctness by tier</p>
          <div className="mt-1.5 space-y-1">
            {summary.tiers.map((t) => (
              <div key={t.tier} className="flex items-center gap-2 text-xs">
                <Badge variant={TIER_VARIANT[t.tier]} className="w-14 justify-center px-1.5 py-0 text-[10px]">
                  {t.tier}
                </Badge>
                <Bar value={t.answerRate} tone="cfg" />
                <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums">{pct(t.answerRate)}</span>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                  {t.trials > 0 ? `${t.trials} run${t.trials === 1 ? "" : "s"}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
