import { EVAL_CASES, type Difficulty } from "@/tests/eval-cases";
import { OUT_OF_SCOPE_CASES } from "@/tests/out-of-scope-cases";
import { labelledChecks, type EvalMode, type EvalTrialResult } from "@/lib/eval-run";
import { trialKey, IDLE, type TrialState } from "@/lib/use-eval-runner";

/**
 * Aggregates the runner's per-trial state into the head-to-head scoreboard —
 * the in-app counterpart of eval 5's comparison table. Labelled rates are
 * computed over ALL collected samples (the pass@N spirit: re-running a case
 * adds a sample, it doesn't overwrite the old one); the out-of-scope x/y
 * counts use each case's latest run so they read as "declined 4/5".
 */

export const MODES: EvalMode[] = ["constrained", "unconstrained"];

export interface ModeSummary {
  /** Labelled samples collected. */
  trials: number;
  execRate: number | null;
  answerRate: number | null;
  /** Over samples that produced SQL. */
  schemaCleanRate: number | null;
  /** Mean generation latency across every sample (labelled + oos). */
  avgGenMs: number | null;
  /** Out-of-scope, latest run per case. */
  oosRun: number;
  oosDeclined: number;
  oosFabricated: number;
  /** Out-of-scope, "phantom-column" subset only (the hard, answerable-looking
   *  ones that tempt fabrication). Latest run per case. */
  oosPhantomRun: number;
  oosPhantomDeclined: number;
  oosPhantomFabricated: number;
  /** Adversarial labelled subset (tag "adversarial"): the answerable prompts
   *  built to tempt the baseline off schema. Where CFG separates on correctness
   *  and schema-grounding. */
  advTrials: number;
  advAnswerRate: number | null;
  advSchemaCleanRate: number | null;
}

interface TierSummary {
  tier: Difficulty;
  cases: number;
  trials: number;
  answerRate: number | null;
}

export interface EvalSummary {
  modes: Record<EvalMode, ModeSummary>;
  tiers: TierSummary[];
  /** Distinct trial slots with at least one collected run. */
  slotsDone: number;
  totalSlots: number;
  /** THE headline, case-level: of the prompts built to break the baseline
   *  (adversarial + phantom-column), how many cases did each mode fail?
   *  Mirrors headlineStats in tests/evals.test.ts — adversarial failure = any
   *  collected run off-schema or non-executing; phantom failure = latest run
   *  answered instead of declining. `run` counts cases with data so partial
   *  sessions don't read as a clean sweep. */
  headline: { n: number; modes: Record<EvalMode, { run: number; failed: number }> };
}

const TOTAL_SLOTS =
  EVAL_CASES.length * MODES.length + OUT_OF_SCOPE_CASES.length * MODES.length;

function rate(passed: number, total: number): number | null {
  return total === 0 ? null : passed / total;
}

export function computeSummary(state: Record<string, TrialState>): EvalSummary {
  const get = (key: string): TrialState => state[key] ?? IDLE;
  let slotsDone = 0;
  const countSlot = (s: TrialState) => {
    if (s.runs.length > 0) slotsDone += 1;
  };

  const ADVERSARIAL_IDS = new Set(
    EVAL_CASES.filter((c) => c.tags.includes("adversarial")).map((c) => c.id),
  );
  const PHANTOM_IDS = new Set(
    OUT_OF_SCOPE_CASES.filter((c) => c.category === "phantom-column").map((c) => c.id),
  );

  const cleanRate = (runs: EvalTrialResult[]): number | null => {
    const withSql = runs.filter((r) => r.sql);
    return rate(withSql.filter((r) => (r.violations?.length ?? 0) === 0).length, withSql.length);
  };

  const modes = {} as Record<EvalMode, ModeSummary>;
  for (const mode of MODES) {
    const labelledRuns: EvalTrialResult[] = [];
    const advRuns: EvalTrialResult[] = [];
    for (const c of EVAL_CASES) {
      const s = get(trialKey({ suite: "labelled", id: c.id, mode }));
      countSlot(s);
      for (const run of s.runs) {
        labelledRuns.push(run);
        if (ADVERSARIAL_IDS.has(c.id)) advRuns.push(run);
      }
    }

    const oosLatest: EvalTrialResult[] = [];
    const oosPhantomLatest: EvalTrialResult[] = [];
    let genMsSum = 0;
    let genMsN = 0;
    for (const c of OUT_OF_SCOPE_CASES) {
      const s = get(trialKey({ suite: "oos", id: c.id, mode }));
      countSlot(s);
      const latest = s.runs[s.runs.length - 1];
      if (latest) {
        oosLatest.push(latest);
        if (PHANTOM_IDS.has(c.id)) oosPhantomLatest.push(latest);
      }
      for (const run of s.runs) {
        if (run.generationMs != null) {
          genMsSum += run.generationMs;
          genMsN += 1;
        }
      }
    }
    for (const run of labelledRuns) {
      if (run.generationMs != null) {
        genMsSum += run.generationMs;
        genMsN += 1;
      }
    }

    const checks = labelledRuns.map((run) => ({ run, c: labelledChecks(run) }));
    const advChecks = advRuns.map((run) => labelledChecks(run));
    // Answer rates exclude the "na" axis (cases that opt out of answer grading)
    // from BOTH numerator and denominator — counting them would dilute the rate.
    const answerPassRate = (cs: { answer: "pass" | "fail" | "na" }[]): number | null => {
      const graded = cs.filter((c) => c.answer !== "na");
      return rate(graded.filter((c) => c.answer === "pass").length, graded.length);
    };

    modes[mode] = {
      trials: labelledRuns.length,
      execRate: rate(checks.filter((x) => x.c.exec === "pass").length, checks.length),
      answerRate: answerPassRate(checks.map((x) => x.c)),
      schemaCleanRate: cleanRate(labelledRuns),
      avgGenMs: genMsN === 0 ? null : genMsSum / genMsN,
      oosRun: oosLatest.length,
      oosDeclined: oosLatest.filter((t) => t.refused).length,
      oosFabricated: oosLatest.filter((t) => (t.violations?.length ?? 0) > 0).length,
      oosPhantomRun: oosPhantomLatest.length,
      oosPhantomDeclined: oosPhantomLatest.filter((t) => t.refused).length,
      oosPhantomFabricated: oosPhantomLatest.filter((t) => (t.violations?.length ?? 0) > 0).length,
      advTrials: advRuns.length,
      advAnswerRate: answerPassRate(advChecks),
      advSchemaCleanRate: cleanRate(advRuns),
    };
  }

  const headlineModes = {} as Record<EvalMode, { run: number; failed: number }>;
  for (const mode of MODES) {
    let run = 0;
    let failed = 0;
    for (const id of ADVERSARIAL_IDS) {
      const runs = get(trialKey({ suite: "labelled", id, mode })).runs;
      if (runs.length === 0) continue;
      run += 1;
      if (runs.some((t) => labelledChecks(t).exec !== "pass" || (t.violations?.length ?? 0) > 0)) {
        failed += 1;
      }
    }
    for (const id of PHANTOM_IDS) {
      const runs = get(trialKey({ suite: "oos", id, mode })).runs;
      const latest = runs[runs.length - 1];
      if (!latest) continue;
      run += 1;
      if (!latest.refused) failed += 1;
    }
    headlineModes[mode] = { run, failed };
  }

  const tiers: TierSummary[] = (["easy", "medium", "hard"] as Difficulty[]).map((tier) => {
    const cases = EVAL_CASES.filter((c) => c.difficulty === tier);
    const runs = cases.flatMap((c) => get(trialKey({ suite: "labelled", id: c.id, mode: "constrained" })).runs);
    // Exclude the "na" axis (ungraded-answer cases) from the tier correctness rate.
    const graded = runs.map((t) => labelledChecks(t)).filter((c) => c.answer !== "na");
    return {
      tier,
      cases: cases.length,
      trials: runs.length,
      answerRate: rate(graded.filter((c) => c.answer === "pass").length, graded.length),
    };
  });

  return {
    modes,
    tiers,
    slotsDone,
    totalSlots: TOTAL_SLOTS,
    headline: { n: ADVERSARIAL_IDS.size + PHANTOM_IDS.size, modes: headlineModes },
  };
}
