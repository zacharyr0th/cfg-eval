import { describe, expect, it } from "vitest";
import { runQuery, type QueryResult } from "@/lib/clickhouse";
import { MODEL_ID } from "@/lib/openai";
import { EVAL_CASES, type Difficulty } from "./eval-cases";
import { OUT_OF_SCOPE_CASES, type OutOfScopeCase } from "./out-of-scope-cases";
import { schemaViolations } from "./sql-introspect";
import { writeRunbookEntry, type RunbookEntry } from "./runbook";
import {
  EVALS_ENABLED,
  EVAL_N,
  compareResults,
  parsesGrammar,
  probe,
  runTrial,
  type Probe,
  type TrialOutcome,
} from "./eval-helpers";

/**
 * End-to-end NL→SQL evals — gated behind `RUN_EVALS=1` because they call the
 * real GPT-5 API and execute against ClickHouse Cloud.
 *
 *   RUN_EVALS=1 bun run test                    # default N=2 trials per case
 *   RUN_EVALS=1 EVAL_N=1 bun run test           # fast smoke run
 *
 * Four suites map to four failure modes a NL→SQL system has, plus a fifth
 * head-to-head that quantifies what the grammar constraint buys:
 *   1. Execution correctness — result matches a LIVE run of the case's
 *      reference SQL (real data, fetched fresh per run — no stored snapshot).
 *   2. SQL validity / executability — every generated query runs on ClickHouse.
 *   3. Schema adherence — generated SQL references only whitelisted columns/functions.
 *   4. Refusal / out-of-scope — unanswerable prompts are declined (cannot_answer), not answered.
 *   5. CFG vs no-CFG — same prompts, both modes, aggregate stats.
 *
 * Suites 1–3 and 5 share ONE expensive run of every case in both modes
 * (loadOrRun); suite 4 adds a small extra prompt set.
 *
 * One ClickHouse-only check (case health — do the distractor queries actually
 * yield a different answer than the reference?) runs without GPT:
 *   VERIFY_CASES=1 bun run test
 */

const CLICKHOUSE_AVAILABLE = !!process.env.CLICKHOUSE_HOST && !!process.env.CLICKHOUSE_PASSWORD;
// Case health needs only ClickHouse — opt in explicitly so the default
// `bun run test` stays fully offline. Always included in a full RUN_EVALS run.
const VERIFY_CASES = CLICKHOUSE_AVAILABLE && (EVALS_ENABLED || !!process.env.VERIFY_CASES);

// EVAL_SLICE=headline trims the paid run to the discriminating slice only: the
// adversarial cases (answerable, tempt the baseline off schema) plus the
// phantom-column refusals (unanswerable, tempt it to fabricate). Those are the
// prompts where the baseline actually fails — the cheap way to (re)produce the
// headline table. The full set stays the default: the clean cases are the
// control arm, proving the grammar costs nothing on ordinary prompts.
const SLICE = process.env.EVAL_SLICE === "headline";
const ACTIVE_CASES = SLICE ? EVAL_CASES.filter((c) => c.tags.includes("adversarial")) : EVAL_CASES;
const ACTIVE_OOS = SLICE
  ? OUT_OF_SCOPE_CASES.filter((c) => c.category === "phantom-column")
  : OUT_OF_SCOPE_CASES;

interface RunBundle {
  case: typeof EVAL_CASES[number];
  reference: QueryResult;
  trials: { constrained: TrialOutcome[]; unconstrained: TrialOutcome[] };
}

// Memoize the PROMISE, not the result — so two concurrent first-callers
// (the describe blocks may start in parallel) share one heavy run instead of
// each kicking off their own.
const SHARED: { bundles: Promise<RunBundle[]> | null } = { bundles: null };

/**
 * Run every case in both modes once at the top of the suite, cache the result,
 * and share across tests. Without this, each describe block would re-spend the
 * entire API budget.
 */
function loadOrRun(): Promise<RunBundle[]> {
  if (SHARED.bundles) return SHARED.bundles;
  SHARED.bundles = (async () => {
    const out: RunBundle[] = [];
    let i = 0;
    for (const c of ACTIVE_CASES) {
      i++;
      const reference = await runQuery(c.referenceSQL);
      const constrained: TrialOutcome[] = [];
      const unconstrained: TrialOutcome[] = [];
      for (let t = 0; t < EVAL_N; t++) {
        constrained.push(await runTrial(c, "constrained", reference, t));
        unconstrained.push(await runTrial(c, "unconstrained", reference, t));
      }
      out.push({ case: c, reference, trials: { constrained, unconstrained } });

      console.log(
        `  loaded ${i}/${ACTIVE_CASES.length}: ${c.id} (cfg correct=${constrained.filter((x) => x.correct).length}/${EVAL_N}, nocfg correct=${unconstrained.filter((x) => x.correct).length}/${EVAL_N})`,
      );
    }
    return out;
  })();
  return SHARED.bundles;
}

/* -------------------------------------------------------------------------- */
/*  Extra prompt set for suite 4 (out-of-scope)                                 */
/* -------------------------------------------------------------------------- */

interface OosOutcome {
  case: OutOfScopeCase;
  constrained: Probe;
  unconstrained: Probe;
}
const OOS: { p: Promise<OosOutcome[]> | null } = { p: null };
function loadOutOfScope(): Promise<OosOutcome[]> {
  if (OOS.p) return OOS.p;
  OOS.p = (async () => {
    const out: OosOutcome[] = [];
    for (const c of ACTIVE_OOS) {
      out.push({
        case: c,
        constrained: await probe(c.question, "constrained"),
        unconstrained: await probe(c.question, "unconstrained"),
      });
    }
    return out;
  })();
  return OOS.p;
}

/* ========================================================================== */
/*  Eval 1 — execution correctness (answer accuracy)                           */
/* ========================================================================== */

describe.skipIf(!EVALS_ENABLED).sequential("eval 1 — execution correctness (answer accuracy)", () => {
  // The model gets credit for ANY query that reproduces the reference answer —
  // not for matching a reference SQL string, which would punish valid
  // rephrasings. The reference answer is REAL data: each case's referenceSQL is
  // executed live against ClickHouse at the top of the run (loadOrRun), so the
  // grader can never drift from what the database actually returns.
  // Only graded cases assert answer-correctness; gradeAnswer:false cases have no
  // canonical answer (see tests/eval-cases.ts) and are covered by evals 2–3 + 5.
  it.each(ACTIVE_CASES.filter((c) => c.gradeAnswer !== false))(
    "$id: constrained result matches the live reference answer (pass@N ≥ 0.5)", async (c) => {
    const bundles = await loadOrRun();
    const b = bundles.find((x) => x.case.id === c.id)!;
    const passes = b.trials.constrained.filter(
      (t) => t.executed && t.result !== null && compareResults(b.reference, t.result, c.compare, c.tolerance),
    ).length;
    const need = Math.max(1, Math.ceil(b.trials.constrained.length * 0.5));
    expect(
      passes >= need,
      `matched the live reference on ${passes}/${b.trials.constrained.length} (needed ${need}). Sample SQL: ${b.trials.constrained[0]?.sql ?? "(none)"}`,
    ).toBe(true);
  });

  // Stratified reporting (Spider/BIRD-style): a set where everything scores 100%
  // can't detect regressions, so correctness is broken out by difficulty tier.
  it("constrained correctness by difficulty tier (diagnostic)", async () => {
    const bundles = await loadOrRun();
    const rows = (["easy", "medium", "hard"] as const).map((tier) => {
      const cases = bundles.filter((b) => b.case.difficulty === tier);
      const trials = cases.flatMap((b) => b.trials.constrained);
      // Correctness is over GRADED cases only (gradeAnswer:false has no canonical
      // answer); `trials` still reports the full tier count for context.
      const graded = cases.filter((b) => b.case.gradeAnswer !== false);
      const gradedTrials = graded.flatMap((b) => b.trials.constrained);
      const passed = graded.flatMap((b) =>
        b.trials.constrained.filter(
          (t) => t.executed && t.result !== null && compareResults(b.reference, t.result, b.case.compare, b.case.tolerance),
        ),
      ).length;
      const correct = gradedTrials.length ? Number((passed / gradedTrials.length).toFixed(3)) : "n/a";
      return { tier, cases: cases.length, trials: trials.length, gradedTrials: gradedTrials.length, correct };
    });
    console.table(rows);
    expect(rows.reduce((s, r) => s + r.cases, 0)).toBe(ACTIVE_CASES.length);
  });
});

// False-positive hardening — a static-dataset adaptation of test-suite accuracy
// (Zhong et al. 2020). On a single DB state, a semantically-wrong query can score
// correct by coincidence. For each "distractor" (a plausible wrong query), assert
// its result DIFFERS from a live run of the reference — proving the case can
// actually fail that wrong query on this data. A distractor that matches the
// reference is a false-positive hole, and this fails loudly. ClickHouse-only (no GPT).
describe.skipIf(!VERIFY_CASES)("false-positive hardening (ClickHouse only)", () => {
  const withDistractors = EVAL_CASES.filter((c) => (c.distractors?.length ?? 0) > 0);
  it.each(withDistractors)("$id: every distractor differs from the reference (case is discriminating)", async (c) => {
    const reference = await runQuery(c.referenceSQL);
    const matches: string[] = [];
    for (const sql of c.distractors!) {
      const r = await runQuery(sql);
      if (compareResults(reference, r, c.compare, c.tolerance)) matches.push(sql);
    }
    expect(
      matches.length,
      `${matches.length} distractor(s) for "${c.id}" matched the reference answer — this case can't distinguish those wrong queries on the dataset (a false-positive hole): ${matches.join(" | ")}`,
    ).toBe(0);
  });
});

/* ========================================================================== */
/*  Eval 2 — SQL validity / executability                                      */
/* ========================================================================== */

describe.skipIf(!EVALS_ENABLED).sequential("eval 2 — SQL validity / executability", () => {
  // The constrained decode is bounded by the same CH SQL subset ClickHouse
  // parses, so an execution failure means the grammar accepted something CH
  // rejected — a real grammar bug.
  it.each(ACTIVE_CASES)("$id: every constrained output executes on ClickHouse", async (c) => {
    const bundles = await loadOrRun();
    const b = bundles.find((x) => x.case.id === c.id)!;
    const offenders = b.trials.constrained.filter((t) => !t.executed);
    expect(
      offenders.length,
      `${offenders.length}/${b.trials.constrained.length} constrained trials failed to execute — first error: ${offenders[0]?.error ?? "(none)"} — SQL: ${offenders[0]?.sql ?? "(none)"}`,
    ).toBe(0);
  });

  it("zero execution failures across the entire constrained set", async () => {
    const bundles = await loadOrRun();
    const trials = bundles.flatMap((b) => b.trials.constrained);
    const failed = trials.filter((t) => !t.executed);
    expect(
      failed.length,
      `${failed.length}/${trials.length} constrained trials failed to execute. First: ${failed[0]?.error ?? "(none)"} — SQL: ${failed[0]?.sql ?? "(none)"}`,
    ).toBe(0);
  });

  it("local Lark parse rate on constrained outputs (diagnostic — logs, no assert)", async () => {
    const bundles = await loadOrRun();
    const trials = bundles.flatMap((b) => b.trials.constrained);
    const parsed = trials.filter((t) => t.parsed).length;
     
    console.log(
      `  local-parse on constrained outputs: ${parsed}/${trials.length} (${((parsed / trials.length) * 100).toFixed(1)}%) — sub-100% reflects Lark↔LLGuidance divergence, not invalid SQL.`,
    );
    expect(trials.length).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/*  Eval 3 — schema adherence / hallucination guard                            */
/* ========================================================================== */

describe.skipIf(!EVALS_ENABLED).sequential("eval 3 — schema adherence / hallucination guard", () => {
  // Every identifier in the generated SQL must be a real column/table/function
  // (or a locally-defined alias). For constrained output this holds by
  // construction — the eval proves the guarantee on actual decodes.
  it.each(ACTIVE_CASES)("$id: constrained SQL references only real columns/functions", async (c) => {
    const bundles = await loadOrRun();
    const b = bundles.find((x) => x.case.id === c.id)!;
    const offenders = b.trials.constrained
      .map((t) => ({ sql: t.sql, violations: schemaViolations(t.sql) }))
      .filter((x) => x.violations.length > 0);
    expect(
      offenders.length,
      `${offenders.length} constrained trial(s) referenced unknown identifiers — e.g. ${JSON.stringify(offenders[0]?.violations)} in: ${offenders[0]?.sql}`,
    ).toBe(0);
  });

  it("unconstrained hallucination rate (diagnostic — what the grammar prevents)", async () => {
    const bundles = await loadOrRun();
    const trials = bundles.flatMap((b) => b.trials.unconstrained);
    const withViol = trials.filter((t) => schemaViolations(t.sql).length > 0);
    const sample = [...new Set(withViol.flatMap((t) => schemaViolations(t.sql).map((v) => v.token)))].slice(0, 10);
     
    console.log(
      `  unconstrained schema violations: ${withViol.length}/${trials.length} trials${sample.length ? ` — sample tokens: ${sample.join(", ")}` : ""}`,
    );
    expect(trials.length).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/*  Eval 4 — refusal / out-of-scope handling                                   */
/* ========================================================================== */

describe.skipIf(!EVALS_ENABLED).sequential("eval 4 — refusal / out-of-scope handling", () => {
  // The constrained path now carries a `cannot_answer` tool alongside the grammar
  // tool (tool_choice:"required"), so on an unanswerable question it should DECLINE
  // rather than be forced into a degenerate query that renders as a confident
  // number. This asserts the abstention directly; the diagnostic shows how often
  // the unconstrained model instead fabricates the missing columns — the failure
  // the abstain path + grammar together prevent.
  it.each(ACTIVE_OOS)("$id: constrained path declines via cannot_answer", async (c) => {
    const outcomes = await loadOutOfScope();
    const o = outcomes.find((x) => x.case.id === c.id)!;
    expect(
      o.constrained.refused,
      `expected the constrained model to decline (${c.reason}), but it emitted SQL: ${o.constrained.sql || "(none)"}`,
    ).toBe(true);
  });

  // Even if a future model regresses and answers instead of declining, the grammar
  // still bars out-of-schema identifiers — keep that as a secondary guarantee.
  it.each(ACTIVE_OOS)("$id: any constrained SQL fabricates no columns", async (c) => {
    const outcomes = await loadOutOfScope();
    const o = outcomes.find((x) => x.case.id === c.id)!;
    const viol = schemaViolations(o.constrained.sql);
    expect(
      viol.length,
      `constrained output referenced out-of-schema identifiers ${JSON.stringify(viol.map((v) => v.token))} — SQL: ${o.constrained.sql}`,
    ).toBe(0);
  });

  it("out-of-scope behaviour (diagnostic): refusal rate + unconstrained fabrication, by category", async () => {
    const outcomes = await loadOutOfScope();
    const refused = outcomes.filter((o) => o.constrained.refused).length;
    const fabricated = outcomes.filter((o) => schemaViolations(o.unconstrained.sql).length > 0);
    const lines = fabricated.map(
      (o) => `${o.case.id}: ${[...new Set(schemaViolations(o.unconstrained.sql).map((v) => v.token))].join(", ")}`,
    );

    // Split by category: "phantom-column" prompts (mta_tax, VendorID, …) look
    // answerable, so they are where the baseline's fabrication rate jumps and
    // the abstain+grammar value stops being tautological. Reporting them apart
    // from the easy out-of-domain refusals keeps that distinction legible.
    const byCat = (["out-of-domain", "phantom-column"] as const).map((cat) => {
      const cs = outcomes.filter((o) => o.case.category === cat);
      return {
        category: cat,
        n: cs.length,
        cfg_declined: cs.filter((o) => o.constrained.refused).length,
        nocfg_fabricated: cs.filter((o) => schemaViolations(o.unconstrained.sql).length > 0).length,
      };
    });

    console.log(
      `  out-of-scope: constrained declined ${refused}/${outcomes.length}; unconstrained fabricated schema on ${fabricated.length}/${outcomes.length}${lines.length ? `:\n    - ${lines.join("\n    - ")}` : ""}`,
    );
    console.table(byCat);
    expect(outcomes.length).toBeGreaterThan(0);
  });
});

/* ========================================================================== */
/*  Eval 5 — CFG vs no-CFG head-to-head (what the grammar buys)                 */
/* ========================================================================== */

describe.skipIf(!EVALS_ENABLED).sequential("eval 5 — CFG vs no-CFG head-to-head", () => {
  it("logs a per-case + overall comparison table", async () => {
    const bundles = await loadOrRun();
    const rows = bundles.map((b) => {
      const c = stats(b.trials.constrained);
      const u = stats(b.trials.unconstrained);
      return {
        case: b.case.id,
        adversarial: b.case.tags.includes("adversarial") ? "✓" : "",
        n: b.trials.constrained.length,
        cfg_exec: c.execRate,
        cfg_correct: c.correctRate,
        cfg_schema: c.schemaClean,
        nocfg_exec: u.execRate,
        nocfg_correct: u.correctRate,
        nocfg_schema: u.schemaClean,
      };
    });

    const overall = {
      cfg: aggregate(bundles.flatMap((b) => b.trials.constrained)),
      nocfg: aggregate(bundles.flatMap((b) => b.trials.unconstrained)),
    };


    console.log("\n--- eval 5: CFG vs no-CFG, per case (rates as fractions) ---");
    console.table(rows);
    console.log("\n--- eval 5: overall ---");
    console.table([
      { mode: "constrained (CFG)", ...overall.cfg },
      { mode: "unconstrained", ...overall.nocfg },
    ]);

    // The headline the critique demands: isolate the ADVERSARIAL slice. Clean
    // prompts saturate both modes at 100% correct and prove nothing; these cases
    // are built to tempt the baseline off schema, so the gap between modes here
    // (correctness AND schema-grounding) is what the grammar actually buys on
    // answerable prompts. Reported, not asserted — the model's failure rate is
    // the measurement, and pinning a baseline number would make the eval flaky.
    const adv = bundles.filter((b) => b.case.tags.includes("adversarial"));
    if (adv.length > 0) {
      console.log(`\n--- eval 5: ADVERSARIAL slice only (${adv.length} cases) ---`);
      console.table([
        { mode: "constrained (CFG)", ...aggregate(adv.flatMap((b) => b.trials.constrained)) },
        { mode: "unconstrained", ...aggregate(adv.flatMap((b) => b.trials.unconstrained)) },
      ]);
    }


    // Hard assertion: the constrained-decode contract is that every output is
    // grammar-conformant by construction, which means ClickHouse must accept
    // every one. (Local Lark parse-rate is a softer signal — logged in eval 2,
    // not asserted, since Lark sometimes diverges from OpenAI's LLGuidance.)
    expect(
      overall.cfg.execRate,
      `CFG execution rate is ${overall.cfg.execRate} — the grammar accepted something ClickHouse rejected.`,
    ).toBe(1);
  });
});

/* ========================================================================== */
/*  HEADLINE — the discriminating slice in one table                            */
/* ========================================================================== */

// The claim this whole suite exists to prove, in one place: on the prompts
// BUILT to make the baseline fail — answerable questions that tempt it off
// schema (adversarial) and unanswerable ones that tempt it to fabricate
// (phantom-column) — the unconstrained model goes wrong and the constrained
// path doesn't. Everything else above is either the control arm (clean prompts
// saturate both modes, i.e. the grammar costs nothing) or per-axis detail.
// The baseline's failure count is reported, not asserted — it's the
// measurement; the constrained side IS asserted clean.
describe.skipIf(!EVALS_ENABLED).sequential("HEADLINE — CFG fixes what the baseline gets wrong", () => {
  it("prints the discriminating-slice table; the constrained side must be clean", async () => {
    const bundles = await loadOrRun();
    const oos = await loadOutOfScope();
    const h = headlineStats(bundles, oos);
    const trunc = (s: string) => (s.length > 70 ? `${s.slice(0, 67)}…` : s);

    const rows = [
      ...h.adv.map((b) => {
        const tokens = [
          ...new Set(b.trials.unconstrained.flatMap((t) => schemaViolations(t.sql).map((v) => v.token))),
        ];
        return {
          prompt: b.case.id,
          kind: "answerable, tempts off-schema",
          "baseline (no CFG)": h.advFail(b.trials.unconstrained)
            ? `off schema${tokens.length ? `: ${tokens.join(", ")}` : " (exec failed)"}`
            : "stayed on schema (this run)",
          "constrained (CFG)": h.advFail(b.trials.constrained) ? "FAILED" : "on schema, executed",
        };
      }),
      ...h.phantom.map((o) => ({
        prompt: o.case.id,
        kind: "unanswerable (phantom column)",
        "baseline (no CFG)": o.unconstrained.refused
          ? "declined (this run)"
          : `confident wrong answer: ${trunc(o.unconstrained.sql)}`,
        "constrained (CFG)": o.constrained.refused
          ? "declined via cannot_answer"
          : `FAILED — answered: ${trunc(o.constrained.sql)}`,
      })),
    ];

    console.log(`\n=== HEADLINE: ${h.n} prompts built to break the baseline ===`);
    console.table(rows);
    console.log(
      `  baseline (no CFG) failed ${h.baselineFailed}/${h.n} · constrained (CFG + abstain) failed ${h.cfgFailed}/${h.n}`,
    );

    expect(
      h.cfgFailed,
      `constrained path failed ${h.cfgFailed}/${h.n} discriminating prompts — see the headline table above`,
    ).toBe(0);
  });
});

/* ========================================================================== */
/*  Reporting — persisted runbook (the offline counterpart to Raindrop)         */
/* ========================================================================== */

// Slice runs (EVAL_SLICE=headline) skip the runbook: a snapshot over 8 hand-
// picked hard cases would read as a regression next to full-set history.
describe.skipIf(!EVALS_ENABLED || SLICE).sequential("reporting — runbook", () => {
  // The cookbook's "Reporting" pillar: snapshot this run's metrics to disk and
  // log deltas vs the previous run, so regressions across model/prompt/grammar
  // changes are visible over time (Raindrop covers the online side).
  it("writes a metrics snapshot and logs deltas vs the previous run", async () => {
    const bundles = await loadOrRun();
    const oos = await loadOutOfScope();
    const headline = headlineStats(bundles, oos);
    const cfg = bundles.flatMap((b) => b.trials.constrained);
    const nocfg = bundles.flatMap((b) => b.trials.unconstrained);

    // Correctness metrics exclude gradeAnswer:false cases (no canonical answer);
    // parse/exec/schema metrics still cover every trial.
    const gradedBundles = bundles.filter((b) => b.case.gradeAnswer !== false);
    const gradedCfg = cfg.filter((t) => t.answerGraded);
    const gradedNocfg = nocfg.filter((t) => t.answerGraded);

    const referenceMatchesOf = (b: typeof bundles[number]) =>
      b.trials.constrained.filter(
        (t) => t.executed && t.result !== null && compareResults(b.reference, t.result, b.case.compare, b.case.tolerance),
      );
    const referenceMatches = gradedBundles.flatMap(referenceMatchesOf).length;

    const byTier: RunbookEntry["byTier"] = {};
    for (const tier of ["easy", "medium", "hard"] as Difficulty[]) {
      const cs = bundles.filter((b) => b.case.difficulty === tier);
      const graded = cs.filter((b) => b.case.gradeAnswer !== false);
      const tr = graded.flatMap((b) => b.trials.constrained);
      const ok = graded.flatMap(referenceMatchesOf).length;
      byTier[tier] = { n: cs.length, correct: tr.length ? Number((ok / tr.length).toFixed(3)) : 0 };
    }

    const entry: Omit<RunbookEntry, "gitSha"> = {
      timestamp: new Date().toISOString(),
      model: MODEL_ID,
      evalN: EVAL_N,
      overall: {
        cfg: { parse: rate(cfg, (t) => t.parsed), exec: rate(cfg, (t) => t.executed), correct: rate(gradedCfg, (t) => t.correct) },
        nocfg: { parse: rate(nocfg, (t) => t.parsed), exec: rate(nocfg, (t) => t.executed), correct: rate(gradedNocfg, (t) => t.correct) },
      },
      byTier,
      perEval: {
        answerPassRate: gradedCfg.length ? Number((referenceMatches / gradedCfg.length).toFixed(3)) : 0,
        schemaViolations: cfg.filter((t) => schemaViolations(t.sql).length > 0).length,
      },
      headline: { n: headline.n, baselineFailed: headline.baselineFailed, cfgFailed: headline.cfgFailed },
    };

    const { written, previous } = writeRunbookEntry(entry);
    console.log("\n--- runbook entry ---");
    console.table([
      {
        when: written.timestamp,
        sha: written.gitSha,
        model: written.model,
        n: written.evalN,
        cfg_correct: written.overall.cfg.correct,
        answer: written.perEval.answerPassRate,
        schemaViol: written.perEval.schemaViolations,
        headline: written.headline
          ? `baseline ${written.headline.baselineFailed}/${written.headline.n} failed · cfg ${written.headline.cfgFailed}/${written.headline.n}`
          : "n/a",
      },
    ]);
    console.table(written.byTier);

    if (previous) {
      const d = (a: number, b: number) => Number((a - b).toFixed(3));
      const prevAnswer = readAnswerPassRate(previous);
      console.log(
        `  Δ vs ${previous.gitSha} @ ${previous.timestamp}: cfg_correct ${d(written.overall.cfg.correct, previous.overall.cfg.correct)}, answer ${prevAnswer === null ? "n/a" : d(written.perEval.answerPassRate, prevAnswer)}`,
      );
      if (prevAnswer !== null && written.perEval.answerPassRate < prevAnswer) {
        console.warn(`  ⚠ REGRESSION: answer pass-rate dropped ${prevAnswer} → ${written.perEval.answerPassRate}`);
      }
    } else {
      console.log("  (first run — no previous entry to compare)");
    }

    expect(written.gitSha).toBeTruthy();
  });
});

/* ========================================================================== */
/*  Offline self-tests (run when RUN_EVALS is NOT set)                          */
/* ========================================================================== */

describe.skipIf(EVALS_ENABLED)("evals (gated — set RUN_EVALS=1 to enable)", () => {
  it("self-test: 'SELECT count() FROM nyc_taxi' parses against the grammar", () => {
    expect(parsesGrammar("SELECT count() FROM nyc_taxi")).toBe(true);
  });

  it.each(EVAL_CASES)("$id: reference SQL parses against the grammar", (c) => {
    expect(parsesGrammar(c.referenceSQL)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Stats helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The discriminating slice reduced to one number-pair: of the prompts built to
 *  break the baseline (adversarial + phantom-column), how many did each mode
 *  fail? Adversarial failure = any trial off-schema or non-executing (2 of the 3
 *  cases have no canonical answer, so grounding/executability is the
 *  apples-to-apples axis); phantom-column failure = answered instead of
 *  declining. Shared by the headline suite and the runbook entry. */
function headlineStats(bundles: RunBundle[], oos: OosOutcome[]) {
  const adv = bundles.filter((b) => b.case.tags.includes("adversarial"));
  const phantom = oos.filter((o) => o.case.category === "phantom-column");
  const advFail = (trials: TrialOutcome[]) =>
    trials.some((t) => !t.executed || schemaViolations(t.sql).length > 0);
  return {
    adv,
    phantom,
    advFail,
    n: adv.length + phantom.length,
    baselineFailed:
      adv.filter((b) => advFail(b.trials.unconstrained)).length +
      phantom.filter((o) => !o.unconstrained.refused).length,
    cfgFailed:
      adv.filter((b) => advFail(b.trials.constrained)).length +
      phantom.filter((o) => !o.constrained.refused).length,
  };
}

/** Read the answer pass-rate from a runbook entry, tolerating the pre-rename
 *  field (`goldenPassRate`) in old history lines. */
function readAnswerPassRate(e: RunbookEntry): number | null {
  const perEval = e.perEval as { answerPassRate?: number; goldenPassRate?: number };
  return perEval.answerPassRate ?? perEval.goldenPassRate ?? null;
}

/** Share of trials whose SQL references only real columns/functions (1.0 = no
 *  fabrication). The discriminating axis on the adversarial + out-of-scope sets:
 *  constrained is 1.0 by construction, the baseline drifts. */
function schemaCleanRate(trials: TrialOutcome[]): number {
  const withSql = trials.filter((t) => t.sql);
  return rate(withSql, (t) => schemaViolations(t.sql).length === 0);
}

/** Correctness over the GRADED trials only (cases with gradeAnswer:false have no
 *  canonical answer and are excluded). Returns "n/a" when nothing is graded. */
function correctRate(trials: TrialOutcome[]): number | "n/a" {
  const graded = trials.filter((t) => t.answerGraded);
  return graded.length === 0 ? "n/a" : rate(graded, (t) => t.correct);
}

function stats(trials: TrialOutcome[]) {
  return {
    parseRate: rate(trials, (t) => t.parsed),
    execRate: rate(trials, (t) => t.executed),
    correctRate: correctRate(trials),
    schemaClean: schemaCleanRate(trials),
  };
}

function aggregate(trials: TrialOutcome[]) {
  return {
    n: trials.length,
    parseRate: rate(trials, (t) => t.parsed),
    execRate: rate(trials, (t) => t.executed),
    correctRate: correctRate(trials),
    schemaClean: schemaCleanRate(trials),
    avgGenMs: trials.length === 0 ? 0 : trials.reduce((s, t) => s + t.generationMs, 0) / trials.length,
  };
}

function rate<T>(arr: T[], pred: (t: T) => boolean): number {
  if (arr.length === 0) return 0;
  return Number((arr.filter(pred).length / arr.length).toFixed(3));
}
