"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HeroBackdrop } from "@/components/hero-backdrop";
import { useEvalRunner, trialKey, IDLE, type TrialState } from "@/lib/use-eval-runner";
import type { EvalMode, EvalRunRequest } from "@/lib/eval-run";
import { computeSummary, MODES } from "@/lib/eval-summary";
import { Scoreboard } from "@/components/evals/scoreboard";
import { LabelledRow } from "@/components/evals/labelled-row";
import { OosRow } from "@/components/evals/oos-row";
import { MethodologyEvals, MethodologyContext } from "@/components/evals/methodology";
import { MODE_HINT } from "@/components/evals/status";
import { SidebarHeader } from "@/components/query/sidebar-header";
import { EVAL_CASES } from "@/tests/eval-cases";
import { OUT_OF_SCOPE_CASES } from "@/tests/out-of-scope-cases";

const LABELLED_SPECS: EvalRunRequest[] = EVAL_CASES.flatMap((c) =>
  MODES.map((mode) => ({ suite: "labelled" as const, id: c.id, mode })),
);
const OOS_SPECS: EvalRunRequest[] = OUT_OF_SCOPE_CASES.flatMap((c) =>
  MODES.map((mode) => ({ suite: "oos" as const, id: c.id, mode })),
);
const ALL_SPECS = [...LABELLED_SPECS, ...OOS_SPECS];
// The discriminating slice — the prompts built to break the baseline
// (adversarial labelled + phantom-column out-of-scope). The in-app counterpart
// of `EVAL_SLICE=headline`: the cheapest run that produces the headline verdict.
const HEADLINE_SPECS: EvalRunRequest[] = [
  ...EVAL_CASES.filter((c) => c.tags.includes("adversarial")).flatMap((c) =>
    MODES.map((mode) => ({ suite: "labelled" as const, id: c.id, mode })),
  ),
  ...OUT_OF_SCOPE_CASES.filter((c) => c.category === "phantom-column").flatMap((c) =>
    MODES.map((mode) => ({ suite: "oos" as const, id: c.id, mode })),
  ),
];

type HealthStatus = "ok" | "unconfigured" | "error";
interface Health {
  openai: HealthStatus;
  clickhouse: HealthStatus;
}

export default function EvalsPage() {
  const { state, busy, pendingCount, run, stop, reset, restore } = useEvalRunner();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: Health) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        /* leave null — don't block the page on a failed probe */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => computeSummary(state), [state]);
  const hasResults = summary.slotsDone > 0;
  const cfg = summary.modes.constrained;
  // The constrained path's contract held — NOT "all 62 passed" (the no-CFG
  // baseline is the foil and is expected to fail). See Scoreboard.
  const cfgHeldContract =
    summary.slotsDone === summary.totalSlots &&
    summary.totalSlots > 0 &&
    cfg.execRate === 1 &&
    cfg.schemaCleanRate === 1 &&
    cfg.answerRate === 1 &&
    cfg.oosRun > 0 &&
    cfg.oosDeclined === cfg.oosRun;
  const unconfigured =
    health !== null && (health.openai === "unconfigured" || health.clickhouse === "unconfigured");

  const st = (spec: EvalRunRequest): TrialState => state[trialKey(spec)] ?? IDLE;
  const doneCount = (specs: EvalRunRequest[]) => specs.filter((s) => st(s).runs.length > 0).length;

  function clearAll() {
    const snapshot = state;
    reset();
    toast("Eval results cleared", { action: { label: "Undo", onClick: () => restore(snapshot) } });
  }

  return (
    <div className="relative isolate flex min-h-0 w-full flex-1">
      <HeroBackdrop contentScrim />

      {/* Left sidebar (lg+): the five eval dimensions */}
      <aside
        aria-label="Eval methodology"
        className="hidden w-80 shrink-0 flex-col border-r border-border/50 bg-background/40 backdrop-blur-sm lg:flex"
      >
        <SidebarHeader title="Methodology" subtitle="One eval per way the system can break." />
        <div className="flex-1 overflow-y-auto p-4">
          <MethodologyEvals />
        </div>
      </aside>

      {/* Runner column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Inline controls bar — mirrors the query page's h-12 header row */}
        <div className="flex h-12 shrink-0 items-center justify-end gap-1.5 border-b border-border/50 px-4 md:px-6">
          {busy ? (
            <>
              <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                {pendingCount} pending
              </span>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={stop}>
                <Square aria-hidden className="h-3.5 w-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <>
              {hasResults && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Clear all results"
                  onClick={clearAll}
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                title={`The discriminating slice only — ${HEADLINE_SPECS.length / MODES.length} prompts built to break the baseline (adversarial + phantom-column), both modes`}
                aria-label={`Run the headline slice (${HEADLINE_SPECS.length} calls)`}
                onClick={() => run(HEADLINE_SPECS)}
                disabled={unconfigured}
              >
                <Play aria-hidden className="h-3.5 w-3.5" />
                <span aria-hidden>Headline · {HEADLINE_SPECS.length} calls</span>
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                title={`Both sections: labelled (${LABELLED_SPECS.length}) + out-of-scope (${OOS_SPECS.length})`}
                aria-label={`Run all ${ALL_SPECS.length} evals (labelled and out-of-scope)`}
                onClick={() => run(ALL_SPECS)}
                disabled={unconfigured}
              >
                <Play aria-hidden className="h-3.5 w-3.5" />
                <span aria-hidden>Run all · {ALL_SPECS.length} calls</span>
              </Button>
            </>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-8 px-4 pb-16 pt-6 md:px-6">
            {/* Plain-language framing first — what's measured and the headline
                verdict, before any methodology. CFG is expanded visibly here
                once; the tooltips elsewhere assume this anchor. */}
            <header>
              <h1 className="text-base font-semibold tracking-tight">
                Grammar-constrained vs free-form text-to-SQL
              </h1>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                <strong className="font-medium text-foreground">CFG</strong> stands for{" "}
                <strong className="font-medium text-foreground">context-free grammar</strong>: the
                model&apos;s decoding is constrained so it can only emit SQL this schema allows. Every
                prompt runs twice — with the grammar (CFG) and without (no CFG). {EVAL_CASES.length}{" "}
                answerable prompts + {OUT_OF_SCOPE_CASES.length} out-of-scope prompts, each in both
                modes, = {ALL_SPECS.length} trials. New to the vocabulary? The{" "}
                <Link
                  href="/about"
                  className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
                >
                  About page
                </Link>{" "}
                defines every term and explains how the grading works.
              </p>
              {/* The headline verdict, surfaced where the eye lands first. Hidden
                  below xl, where the inline Scoreboard (with the same banner)
                  renders directly underneath and would duplicate it. */}
              {cfgHeldContract && (
                <p className="mt-2.5 hidden max-w-2xl items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 xl:flex dark:text-emerald-400">
                  <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong className="font-semibold">Headline result:</strong> the grammar-constrained
                    mode produced valid, schema-grounded SQL on all {summary.totalSlots / 2} of its
                    trials and declined every out-of-scope question. The unconstrained baseline drifted
                    off-schema and answered questions the data can&apos;t support.
                  </span>
                </p>
              )}
              <details className="mt-2.5 max-w-2xl text-xs">
                <summary className="cursor-pointer select-none font-medium text-muted-foreground transition-colors hover:text-foreground">
                  What the result labels mean
                </summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 leading-relaxed text-muted-foreground">
                  {[
                    ["pass", "ran on ClickHouse, matched the reference answer, and stayed inside the schema."],
                    ["wrong answer", "ran, but the result didn't match the reference answer."],
                    ["didn't execute", "ClickHouse rejected the generated SQL."],
                    ["off-schema", "an answerable question, but the SQL referenced columns or functions the schema doesn't have."],
                    ["declined", "the model refused via cannot_answer — the correct outcome for out-of-scope questions."],
                    ["answered anyway", "an out-of-scope question got a confident fabricated answer instead of a refusal."],
                    ["off-schema SQL", "the fabricated answer also used invented columns — fabrication plus schema drift."],
                  ].map(([label, meaning]) => (
                    <div key={label} className="contents">
                      <dt className="font-mono text-[11px] text-foreground/80">{label}</dt>
                      <dd>{meaning}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </header>

            {unconfigured && (
              <div role="alert" className="rounded-xl border border-border/50 bg-card/60 p-4 text-sm shadow-[var(--shadow-sm)] backdrop-blur-md">
                <p className="font-medium">Evals need a model and a database</p>
                <p className="mt-1 text-muted-foreground">
                  {health?.openai === "unconfigured" && (
                    <>
                      Set <code className="rounded bg-muted px-1 font-mono text-xs">OPENAI_API_KEY</code>
                      {health.clickhouse === "unconfigured" ? " and " : " "}
                    </>
                  )}
                  {health?.clickhouse === "unconfigured" && (
                    <>
                      <code className="rounded bg-muted px-1 font-mono text-xs">CLICKHOUSE_HOST</code> +{" "}
                      <code className="rounded bg-muted px-1 font-mono text-xs">CLICKHOUSE_PASSWORD</code>{" "}
                    </>
                  )}
                  in <code className="rounded bg-muted px-1 font-mono text-xs">.env.local</code>, then restart
                  the dev server. The offline checks (
                  <code className="rounded bg-muted px-1 font-mono text-xs">bun run test</code>) work without
                  either.
                </p>
              </div>
            )}
            {health?.clickhouse === "error" && (
              <div role="alert" className="rounded-xl border border-border/50 bg-card/60 p-4 text-sm shadow-[var(--shadow-sm)] backdrop-blur-md">
                <p className="font-medium">ClickHouse is unreachable</p>
                <p className="mt-1 text-muted-foreground">
                  Generation will work but every execution will fail — check the connection before reading the
                  numbers as model quality.
                </p>
              </div>
            )}

            {/* Scoreboard — only shown inline on screens narrower than xl (right sidebar takes over at xl+) */}
            <div className="xl:hidden">
              <Scoreboard summary={summary} />
            </div>

            <Section
              evals={[
                { n: 1, label: "result correctness" },
                { n: 2, label: "SQL validity" },
                { n: 3, label: "schema adherence" },
              ]}
              title="Labelled cases"
              description="Each trial is graded on three axes: it executes, matches a live ClickHouse run of the reference SQL, and stays inside the schema whitelist. Eval 5 has no section of its own — it's the CFG / no CFG comparison in every row here and in the scoreboard."
              done={doneCount(LABELLED_SPECS)}
              total={LABELLED_SPECS.length}
              onRun={() => run(LABELLED_SPECS)}
              runDisabled={unconfigured}
            >
              {EVAL_CASES.map((c) => (
                <LabelledRow
                  key={c.id}
                  case={c}
                  cfg={st({ suite: "labelled", id: c.id, mode: "constrained" })}
                  baseline={st({ suite: "labelled", id: c.id, mode: "unconstrained" })}
                  onRun={() => run(MODES.map((mode) => ({ suite: "labelled" as const, id: c.id, mode })))}
                  onRunMode={(mode: EvalMode) => run([{ suite: "labelled", id: c.id, mode }])}
                />
              ))}
            </Section>

            <Section
              evals={[{ n: 4, label: "refusal" }]}
              title="Out-of-scope questions"
              description="The schema has no weather, drivers, vehicles, lat/long, or PII. The constrained path must decline via cannot_answer; the unconstrained baseline shows what fabrication looks like."
              done={doneCount(OOS_SPECS)}
              total={OOS_SPECS.length}
              onRun={() => run(OOS_SPECS)}
              runDisabled={unconfigured}
            >
              {OUT_OF_SCOPE_CASES.map((c) => (
                <OosRow
                  key={c.id}
                  case={c}
                  cfg={st({ suite: "oos", id: c.id, mode: "constrained" })}
                  baseline={st({ suite: "oos", id: c.id, mode: "unconstrained" })}
                  onRun={() => run(MODES.map((mode) => ({ suite: "oos" as const, id: c.id, mode })))}
                  onRunMode={(mode: EvalMode) => run([{ suite: "oos", id: c.id, mode }])}
                />
              ))}
            </Section>

            {/* Methodology inline on smaller screens (sidebar hides below lg) */}
            <div className="lg:hidden">
              <h2 className="text-sm font-semibold">How these evals work</h2>
              <div className="mt-3">
                <MethodologyEvals />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar (xl+): live scoreboard + methodology context */}
      <aside
        aria-label="Eval scoreboard"
        className="hidden w-80 shrink-0 flex-col border-l border-border/50 bg-background/40 backdrop-blur-sm xl:flex"
      >
        <SidebarHeader
          title="Scoreboard"
          subtitle={
            cfgHeldContract
              ? `${summary.totalSlots / 2}/${summary.totalSlots / 2} CFG clean`
              : `${summary.slotsDone}/${summary.totalSlots} trials`
          }
        />
        <div className="flex-1 overflow-y-auto p-4">
          <Scoreboard summary={summary} />
        </div>
      </aside>
    </div>
  );
}

function Section({
  evals,
  title,
  description,
  done,
  total,
  onRun,
  runDisabled,
  children,
}: {
  evals: { n: number; label: string }[];
  title: string;
  description: string;
  done: number;
  total: number;
  onRun: () => void;
  runDisabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {evals.map((e) => (
              <span
                key={e.n}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                <span className="font-mono text-foreground/70">eval {e.n}</span>
                {e.label}
              </span>
            ))}
          </div>
          <h2 className="mt-2 text-sm font-semibold">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {done}/{total} run
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={`${total / MODES.length} cases × ${MODES.length} modes`}
            onClick={onRun}
            disabled={runDisabled}
          >
            <Play aria-hidden className="h-3.5 w-3.5" />
            Run section · {total} calls
          </Button>
        </div>
      </div>
      <div className="mt-3 divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50 bg-card/60 shadow-[var(--shadow-sm)] backdrop-blur-md">
        {/* Column header — labels the per-row status cells once, instead of in all 18 rows */}
        <div aria-hidden className="hidden items-center gap-x-4 bg-background/30 px-4 py-1.5 sm:flex">
          <span className="flex-1 pl-6 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Question
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            <span title={MODE_HINT.constrained} className="w-24 cursor-help font-mono">
              CFG
            </span>
            <span title={MODE_HINT.unconstrained} className="w-24 cursor-help font-mono">
              no CFG
            </span>
            <span className="w-8" />
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
