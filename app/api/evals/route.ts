import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { isOpenAIConfigured, MODEL_ID } from "@/lib/openai";
import { isClickHouseConfigured, runQuery, type QueryResult } from "@/lib/clickhouse";
import { generateSQL } from "@/lib/nl-to-sql";
import { rateLimit } from "@/lib/rate-limit";
import { anonUserId, traceEvalTrial } from "@/lib/raindrop";
import { compareResults } from "@/lib/result-compare";
import type { EvalRunError, EvalTrialResult } from "@/lib/eval-run";
import { EVAL_CASES } from "@/tests/eval-cases";
import { OUT_OF_SCOPE_CASES } from "@/tests/out-of-scope-cases";
import { schemaViolations } from "@/tests/sql-introspect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/evals — run ONE eval trial and return its graded outcome. The
 * /evals page orchestrates a whole suite by posting one request per trial
 * (bounded client-side concurrency), so each HTTP call stays a single
 * generate→execute→grade pass, progress renders live, and a Stop button just
 * aborts the queue.
 *
 * Only the predefined eval prompts can run — the question is resolved
 * server-side from the same case files the vitest suite uses (tests/
 * eval-cases.ts, out-of-scope-cases.ts), and grading reuses the suite's own
 * functions (compareResults, schemaViolations). The expected answer is REAL
 * data: the case's reference SQL is executed against ClickHouse fresh for
 * every trial, and the model's result set is compared to that live answer —
 * nothing is graded against a stored snapshot. This route is therefore a
 * window onto the eval harness, not a free-form GPT proxy.
 *
 * Responses (see lib/eval-run.ts): HTTP 200 means "the trial ran" — including
 * trials where the model failed; that failure IS the eval result. Non-200 is
 * reserved for requests that never ran: 400 bad input, 429 rate limited,
 * 503 missing config.
 *
 * No caching, deliberately: evals are samples of model behaviour, so every
 * run must be a fresh decode (the /api/query response cache would otherwise
 * make repeat runs trivially deterministic).
 */

const Body = z.object({
  suite: z.enum(["labelled", "oos"]),
  id: z.string().min(1).max(100),
  mode: z.enum(["constrained", "unconstrained"]),
  trial: z.number().int().min(0).max(99).optional(),
});

// One trial = one GPT-5 generation + one ClickHouse query. A full in-app run
// (21 labelled ×2 modes + 10 out-of-scope ×2 = 62 trials) arrives at client
// concurrency 2 over a few minutes, so this cap never gates an honest run —
// only a script hammering the endpoint.
const RATE_LIMIT = { limit: 80, windowMs: 60_000 };

/** Cap transported rows. Chosen above the largest expected eval result (31
 *  rows) so the client's agreement checks normally see complete sets; if a
 *  rogue query exceeds it, `rowsTruncated` tells the client to skip them. */
const MAX_ROWS = 50;

function err(status: number, body: EvalRunError): NextResponse {
  return NextResponse.json(body, { status });
}

interface ResolvedPrompt {
  question: string;
  /** Trace id: the case id. */
  traceId: string;
}

function resolvePrompt(b: z.infer<typeof Body>): ResolvedPrompt | null {
  if (b.suite === "labelled") {
    const c = EVAL_CASES.find((x) => x.id === b.id);
    return c ? { question: c.question, traceId: c.id } : null;
  }
  const c = OUT_OF_SCOPE_CASES.find((x) => x.id === b.id);
  return c ? { question: c.question, traceId: c.id } : null;
}

function clampRows(r: QueryResult): { columns: string[]; rows: unknown[][]; truncated: boolean } {
  return {
    columns: [...r.columns],
    rows: r.rows.slice(0, MAX_ROWS).map((row) => [...row]),
    truncated: r.rows.length > MAX_ROWS,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!isOpenAIConfigured()) {
    return err(503, { errorKind: "missing_openai_key", error: "Set OPENAI_API_KEY in .env.local and restart." });
  }
  if (!isClickHouseConfigured()) {
    return err(503, {
      errorKind: "missing_clickhouse_config",
      error: "Set CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD in .env.local and restart.",
    });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message ?? "invalid body" : "invalid JSON";
    return err(400, { errorKind: "bad_request", error: message });
  }

  const prompt = resolvePrompt(body);
  if (!prompt) {
    return err(400, { errorKind: "bad_request", error: `unknown ${body.suite} case: ${body.id}` });
  }

  const limit = rateLimit(`evals:${anonUserId(req)}`, RATE_LIMIT);
  if (!limit.ok) {
    return err(429, {
      errorKind: "rate_limited",
      error: `Too many eval trials — try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const labelled = body.suite === "labelled" ? EVAL_CASES.find((c) => c.id === body.id) : undefined;
  // Some labelled cases opt out of answer grading (no canonical answer — graded
  // on exec + schema only). For those we skip the reference run entirely: there's
  // nothing to compare against, and the reference number itself would be a
  // misleading "expected" value (see gradeAnswer in tests/eval-cases.ts).
  const gradeAnswer = labelled ? labelled.gradeAnswer !== false : false;

  // ---- Live reference answer (graded labelled cases) -----------------------
  // The expected result is real data, fetched fresh per trial: run the case's
  // reference SQL on ClickHouse *before* spending a GPT generation, so a broken
  // reference (or a down database) aborts the trial instead of mis-grading it.
  let reference: QueryResult | null = null;
  if (labelled && gradeAnswer) {
    try {
      reference = await runQuery(labelled.referenceSQL);
    } catch (e) {
      return err(503, {
        errorKind: "reference_failed",
        error: `Reference query for "${labelled.id}" failed on ClickHouse: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const result: EvalTrialResult = {
    suite: body.suite,
    id: body.id,
    mode: body.mode,
    question: prompt.question,
    model: MODEL_ID,
    refused: false,
    executed: false,
  };
  // Mark ungraded-answer cases so the client renders the answer axis as N/A
  // (not "wrong answer") and the scoreboard excludes them from correctness.
  if (labelled && !gradeAnswer) result.answerGraded = false;
  if (labelled && reference) {
    result.compare = labelled.compare;
    result.tolerance = labelled.tolerance;
    const clamped = clampRows(reference);
    result.expected = { columns: clamped.columns, rows: clamped.rows };
    result.expectedTruncated = clamped.truncated || undefined;
  }

  // ---- Generation ----------------------------------------------------------
  try {
    const gen = await generateSQL(prompt.question, body.mode);
    result.generationMs = gen.latencyMs;
    result.usage = gen.usage;
    if (gen.kind === "refusal") {
      result.refused = true;
      result.refusalReason = gen.reason;
    } else {
      result.sql = gen.sql;
    }
  } catch (e) {
    result.generationError = e instanceof Error ? e.message : String(e);
  }

  // ---- Execution + grading -------------------------------------------------
  if (result.sql) {
    result.violations = schemaViolations(result.sql).map((v) => ({ token: v.token, kind: v.kind }));
    const execStart = Date.now();
    try {
      // The constrained decode is grammar-conformant by construction — run it
      // exactly as /api/query does. Unconstrained output is unvetted model
      // text, so it gets the same readonly=2 backstop as user-edited SQL.
      const exec = await runQuery(result.sql, { readonly: body.mode === "unconstrained" });
      result.executed = true;
      result.executionMs = Date.now() - execStart;
      const clamped = clampRows(exec);
      result.columns = clamped.columns;
      result.rows = clamped.rows;
      result.rowsTruncated = clamped.truncated || undefined;
      if (labelled && reference) {
        // Compare the FULL (un-clamped) result sets — transport caps never
        // affect the verdict.
        result.correct = compareResults(reference, exec, labelled.compare, labelled.tolerance);
      }
    } catch (e) {
      result.executionError = e instanceof Error ? e.message : String(e);
    }
  }

  // ---- Tracing (post-response, same event name as the vitest harness) ------
  after(() =>
    traceEvalTrial({
      caseId: prompt.traceId,
      question: prompt.question,
      sql: result.sql ?? "",
      model: MODEL_ID,
      mode: body.mode,
      // No local Lark check in the app runner (that diagnostic needs the
      // python venv) — report parsed=true so the parse-failure signal stays
      // exclusively the offline harness's; app runs are filterable by source.
      parsed: true,
      executed: result.executed,
      correct: result.correct ?? false,
      generationMs: result.generationMs ?? 0,
      trial: body.trial ?? 0,
      error: result.generationError ?? result.executionError,
      source: "app",
    }),
  );

  return NextResponse.json(result);
}
