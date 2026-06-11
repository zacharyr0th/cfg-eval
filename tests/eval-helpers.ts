import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateSQLConstrained, generateSQLUnconstrained, type Mode } from "@/lib/nl-to-sql";
import { runQuery, type QueryResult } from "@/lib/clickhouse";
import { MODEL_ID } from "@/lib/openai";
import { traceEvalTrial } from "@/lib/raindrop";
import { compareResults } from "@/lib/result-compare";
import type { EvalCase } from "./eval-cases";

/* -------------------------------------------------------------------------- */
/*  Gating                                                                     */
/* -------------------------------------------------------------------------- */

export const EVALS_ENABLED =
  !!process.env.RUN_EVALS &&
  !!process.env.OPENAI_API_KEY &&
  !!process.env.CLICKHOUSE_HOST &&
  !!process.env.CLICKHOUSE_PASSWORD;

/** Number of trials per case. Override with EVAL_N=… */
export const EVAL_N = Number(process.env.EVAL_N ?? "2");

/* -------------------------------------------------------------------------- */
/*  Trial execution                                                            */
/* -------------------------------------------------------------------------- */

export interface TrialOutcome {
  /** Did the model emit something the grammar would accept? */
  parsed: boolean;
  /** Did ClickHouse execute the SQL without error? */
  executed: boolean;
  /** Did the result set match the reference (per the case's compare mode)?
   *  Always false when `answerGraded` is false (the case has no canonical answer). */
  correct: boolean;
  /** False for cases that opt out of answer grading (gradeAnswer:false) — their
   *  correctness is not measured; they're judged on exec + schema only. */
  answerGraded: boolean;
  /** Wall-clock latency for the generation call. */
  generationMs: number;
  /** The SQL the model produced (for debugging failed trials). */
  sql: string;
  /**
   * The executed result set — kept so the correctness eval can compare it to the
   * live reference answer (#1) without re-running the query. Null if it never
   * executed.
   */
  result: QueryResult | null;
  /** First-error message if any step failed. */
  error?: string;
}

/** A single generate→parse→execute pass, without any correctness judgement. */
export interface Probe {
  question: string;
  mode: Mode;
  sql: string;
  parsed: boolean;
  executed: boolean;
  result: QueryResult | null;
  generationMs: number;
  /** Constrained path only: the model called `cannot_answer` (no SQL produced). */
  refused: boolean;
  /** The model's stated reason, when `refused`. */
  refusalReason?: string;
  error?: string;
}

/**
 * Generate SQL for one question in one mode, check it against the grammar, and
 * execute it. The shared primitive behind both labelled trials (which add a
 * correctness comparison) and the unlabelled probes the out-of-scope (#4) suite
 * uses. Never throws — failures land on the result object.
 */
export async function probe(question: string, mode: Mode): Promise<Probe> {
  let sql = "";
  let generationMs = 0;
  try {
    const r = mode === "constrained"
      ? await generateSQLConstrained(question)
      : await generateSQLUnconstrained(question);
    generationMs = r.latencyMs;
    if (r.kind === "refusal") {
      // Constrained path declined via cannot_answer — no SQL to parse or run.
      return { question, mode, sql: "", parsed: false, executed: false, result: null, generationMs, refused: true, refusalReason: r.reason };
    }
    sql = r.sql;
  } catch (e) {
    return { question, mode, sql: "", parsed: false, executed: false, result: null, generationMs: 0, refused: false, error: `generation failed: ${errMsg(e)}` };
  }

  const parsed = parsesGrammar(sql);
  try {
    const result = await runQuery(sql);
    return { question, mode, sql, parsed, executed: true, result, generationMs, refused: false };
  } catch (e) {
    return { question, mode, sql, parsed, executed: false, result: null, generationMs, refused: false, error: `clickhouse: ${errMsg(e)}` };
  }
}

/**
 * Run one labelled case through one mode once: probe, then compare the result to
 * the reference (per the case's compare mode). Never throws.
 */
async function computeTrial(eval_: EvalCase, mode: Mode, reference: QueryResult): Promise<TrialOutcome> {
  const p = await probe(eval_.question, mode);
  // Cases with no canonical answer (gradeAnswer:false) are not graded for
  // correctness — they're schema-drift probes judged on exec + schema only.
  const answerGraded = eval_.gradeAnswer !== false;
  const correct =
    answerGraded && p.executed && p.result !== null
      ? compareResults(reference, p.result, eval_.compare, eval_.tolerance)
      : false;
  return {
    parsed: p.parsed,
    executed: p.executed,
    correct,
    answerGraded,
    generationMs: p.generationMs,
    sql: p.sql,
    result: p.result,
    error: p.error,
  };
}

/**
 * Public entry: run one trial, then trace it to Raindrop (a no-op without a
 * write key). Tracing is awaited so the event is delivered before the test
 * process exits — eval volume is tiny, so the extra POSTs don't matter. The
 * eval event lands under a distinct name (`nl_to_sql_eval`) so offline eval
 * runs stay separable from production traffic in the dashboard.
 */
export async function runTrial(
  eval_: EvalCase,
  mode: Mode,
  reference: QueryResult,
  trial = 0,
): Promise<TrialOutcome> {
  const outcome = await computeTrial(eval_, mode, reference);
  await traceEvalTrial({
    caseId: eval_.id,
    question: eval_.question,
    sql: outcome.sql,
    model: MODEL_ID,
    mode,
    parsed: outcome.parsed,
    executed: outcome.executed,
    correct: outcome.correct,
    generationMs: outcome.generationMs,
    trial,
    error: outcome.error,
  });
  return outcome;
}

/* -------------------------------------------------------------------------- */
/*  Grammar parse via the Python helper (single source of truth)              */
/* -------------------------------------------------------------------------- */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PYTHON = `${ROOT}/.venv/bin/python3`;
const SCRIPT = `${ROOT}/scripts/check_grammar.py`;
const PYTHON_AVAILABLE = existsSync(PYTHON);

export function parsesGrammar(sql: string): boolean {
  if (!PYTHON_AVAILABLE) {
    console.warn("parsesGrammar: .venv not found — grammar check skipped, returning true");
    return true;
  }
  try {
    const out = execFileSync(PYTHON, [SCRIPT, "-"], { input: sql, encoding: "utf8" });
    return out.startsWith("OK:");
  } catch (e) {
    const out = e instanceof Error && "stdout" in e ? String((e as { stdout?: unknown }).stdout ?? "") : "";
    return out.startsWith("OK:");
  }
}

/* -------------------------------------------------------------------------- */
/*  Result-set comparison — canonical implementation lives in lib/ so the      */
/*  in-app eval runner (/api/evals + the /evals page) judges trials with the   */
/*  exact same function. Re-exported so suite imports stay unchanged.          */
/* -------------------------------------------------------------------------- */

export { compareResults };

/* -------------------------------------------------------------------------- */
/*  Misc                                                                       */
/* -------------------------------------------------------------------------- */

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
