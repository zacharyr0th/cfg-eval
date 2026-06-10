import type { CompareMode } from "@/lib/result-compare";

/**
 * Shared contract for the in-app eval runner: the /evals page POSTs one
 * {@link EvalRunRequest} per trial to /api/evals and gets one
 * {@link EvalTrialResult} back. Pure types + client-safe verdict helpers —
 * imported on both sides so the grading the UI renders is exactly what the
 * server computed.
 *
 * A trial that *ran* always comes back HTTP 200, even when the model failed —
 * a generation error, an execution error, or a wrong answer is an eval
 * RESULT, not a request failure. Non-200 is reserved for requests that never
 * ran: bad input (400), rate limit (429), missing config (503).
 */

type EvalSuite = "labelled" | "oos";
export type EvalMode = "constrained" | "unconstrained";

export interface EvalRunRequest {
  suite: EvalSuite;
  /** Case id (labelled or out-of-scope). */
  id: string;
  mode: EvalMode;
  /** 0-based repeat counter, echoed into tracing so re-runs stay ordered. */
  trial?: number;
}

export interface EvalTrialResult {
  suite: EvalSuite;
  id: string;
  mode: EvalMode;
  question: string;
  model: string;

  /* Generation — exactly one of: sql, refused, or generationError. */
  sql?: string;
  refused: boolean;
  refusalReason?: string;
  generationError?: string;
  generationMs?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };

  /* Execution (only attempted when sql was produced). */
  executed: boolean;
  executionError?: string;
  executionMs?: number;
  columns?: string[];
  rows?: unknown[][];
  /** True when rows were capped for transport — agreement checks must skip. */
  rowsTruncated?: boolean;

  /* Grading. */
  /** Labelled only: result set matches a live run of the case's reference SQL. */
  correct?: boolean;
  /** Labelled only: false when the case opts out of answer grading (no canonical
   *  answer — graded on exec + schema only). Undefined/true ⇒ graded normally. */
  answerGraded?: boolean;
  /** Out-of-schema identifiers in the SQL — the schema-adherence check. */
  violations?: { token: string; kind: string }[];
  /** Labelled only: the live reference answer (fresh ClickHouse run of the
   *  case's referenceSQL, executed for this trial), for side-by-side display. */
  expected?: { columns: string[]; rows: unknown[][] };
  /** True when the expected rows were capped for transport. */
  expectedTruncated?: boolean;
  /** Comparison semantics for this case/group (drives client agreement checks). */
  compare?: CompareMode;
  tolerance?: number;
}

/** Non-200 body: the trial never ran. */
export interface EvalRunError {
  error: string;
  errorKind:
    | "bad_request"
    | "rate_limited"
    | "missing_openai_key"
    | "missing_clickhouse_config"
    /** The case's reference SQL itself failed on ClickHouse — an infra/case
     *  problem, not a model result, so the trial is not graded. */
    | "reference_failed";
  retryAfterMs?: number;
}

/* -------------------------------------------------------------------------- */
/*  Verdicts — one per failure axis, mirroring the vitest suites               */
/* -------------------------------------------------------------------------- */

export type CheckState = "pass" | "fail" | "na";

export interface LabelledChecks {
  /** Eval 2 — SQL validity: the query executed on ClickHouse. */
  exec: CheckState;
  /** Eval 1 — execution correctness: result equals a live run of the reference SQL. */
  answer: CheckState;
  /** Eval 3 — schema adherence: no out-of-schema identifiers. */
  schema: CheckState;
}

/** Grade one labelled trial along the three per-case eval axes. */
export function labelledChecks(t: EvalTrialResult): LabelledChecks {
  // A refusal or generation failure on an answerable question fails everything
  // downstream: there is no SQL to execute, match, or inspect.
  if (!t.sql) {
    return { exec: "fail", answer: "fail", schema: "na" };
  }
  return {
    exec: t.executed ? "pass" : "fail",
    // A case can opt out of answer grading when it has no canonical answer
    // (gradeAnswer:false) — then the answer axis is N/A, not a failure, and the
    // case is judged on executability + schema-grounding alone.
    answer: t.answerGraded === false ? "na" : t.correct ? "pass" : "fail",
    schema: (t.violations?.length ?? 0) === 0 ? "pass" : "fail",
  };
}

/** Did a labelled trial pass every applicable axis? */
export function labelledPass(t: EvalTrialResult): boolean {
  const c = labelledChecks(t);
  return ([c.exec, c.answer, c.schema] as CheckState[]).every((s) => s !== "fail");
}
