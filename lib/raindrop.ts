import "server-only";
import { createHash, randomUUID } from "node:crypto";

/**
 * Raindrop ingestion (write side) over the raw HTTP API.
 *
 * Why HTTP and not the `raindrop-ai` SDK: this runs inside a Next.js serverless
 * route. The SDK queues events in an internal batch buffer that must be flushed
 * with `raindrop.close()` before the function suspends — easy to drop on a
 * Vercel freeze. A direct `await fetch` to the ingestion endpoint completes
 * within the request lifecycle (we invoke it from `after()`, post-response), so
 * an event is never left buffered. It also matches this repo's "call the API
 * directly, skip the wrapper SDK" stance — see lib/nl-to-sql.ts hitting the raw
 * OpenAI Responses API.
 *
 * Everything here is a no-op unless RAINDROP_WRITE_KEY is set, so local dev and
 * CI stay silent — exactly like isOpenAIConfigured()/isClickHouseConfigured().
 *
 * Endpoints + payload shapes follow https://raindrop.ai/docs/sdk/http-api — the
 * write key is the ingestion key, distinct from the Query (read) API key.
 */

const EVENTS_URL = "https://api.raindrop.ai/v1/events/track";
const SIGNALS_URL = "https://api.raindrop.ai/v1/signals/track";
const EVENT_NAME = "nl_to_sql";
const DEBUG = process.env.NODE_ENV !== "production";

function isRaindropConfigured(): boolean {
  return Boolean(process.env.RAINDROP_WRITE_KEY?.trim());
}

function writeKey(): string | null {
  return process.env.RAINDROP_WRITE_KEY?.trim() || null;
}

/** Outcome of one NL→SQL request — drives both the event property and the signal. */
export type QueryOutcome =
  | "ok"
  | "empty_result"
  | "out_of_scope"
  | "execution_failed"
  | "generation_failed"
  | "invalid_request"
  | "rate_limited"
  | "not_configured";

/**
 * Negative signal (and polarity) emitted for a given outcome; null = no signal.
 * `out_of_scope` is null — a correct refusal of an unanswerable question is the
 * system working as intended, not a failure, so it carries no negative signal
 * (it stays filterable via the `outcome` event property).
 */
const SIGNAL_FOR: Record<QueryOutcome, { name: string; sentiment: "NEGATIVE" } | null> = {
  ok: null,
  empty_result: { name: "empty_result", sentiment: "NEGATIVE" },
  out_of_scope: null,
  execution_failed: { name: "execution_failed", sentiment: "NEGATIVE" },
  generation_failed: { name: "generation_failed", sentiment: "NEGATIVE" },
  invalid_request: { name: "invalid_request", sentiment: "NEGATIVE" },
  rate_limited: { name: "rate_limited", sentiment: "NEGATIVE" },
  not_configured: { name: "service_not_configured", sentiment: "NEGATIVE" },
};

export interface TraceInput {
  /** Client-generated id; correlates the event with any signal we attach to it. */
  eventId: string;
  userId: string;
  question: string;
  /** Generated SQL, or null if generation failed before producing any. */
  sql: string | null;
  model: string;
  mode: "constrained" | "unconstrained";
  outcome: QueryOutcome;
  cached: boolean;
  reasoningEffort?: string;
  generationMs?: number;
  executionMs?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  rowCount?: number;
  columnCount?: number;
  openaiResponseId?: string;
  error?: string;
  /** Why the model declined, when `outcome` is `out_of_scope`. */
  refusalReason?: string;
  /** First few result rows, for at-a-glance debugging in the Raindrop trace. */
  resultPreview?: ReadonlyArray<ReadonlyArray<unknown>>;
}

/** Fresh event id. Generated per request so each trace stands on its own. */
export function newEventId(): string {
  return randomUUID();
}

/**
 * Coarse, non-reversible per-client id derived from the forwarded IP — gives
 * Raindrop real user cohorts without persisting raw PII. Falls back to a single
 * "anonymous" bucket when no IP is present (e.g. local curl). Swap for a real
 * auth subject once /api/query is no longer open.
 */
export function anonUserId(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return "anonymous";
  return "anon_" + createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

async function post(url: string, body: unknown): Promise<boolean> {
  const key = writeKey();
  if (!key) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && DEBUG) {
      const text = await res.text().catch(() => "");
      console.warn(`[raindrop] ${url} -> ${res.status} ${text}`);
    }
    return res.ok;
  } catch (e) {
    // Tracing must never break the request path — log and move on.
    if (DEBUG) {
      console.warn(`[raindrop] ${url} failed:`, e instanceof Error ? e.message : e);
    }
    return false;
  }
}

/**
 * Emit one event for a finished NL→SQL request, then a signal for any notable
 * outcome (execution failure / empty result / generation failure). Designed to
 * be called from `after()` so it never adds latency to the user's response.
 */
export async function traceQuery(t: TraceInput): Promise<void> {
  if (!isRaindropConfigured()) return;

  const properties: Record<string, unknown> = {
    mode: t.mode,
    outcome: t.outcome,
    cached: t.cached,
    model: t.model,
  };
  if (t.reasoningEffort) properties.reasoningEffort = t.reasoningEffort;
  if (t.generationMs !== undefined) properties.generationMs = t.generationMs;
  if (t.executionMs !== undefined) properties.executionMs = t.executionMs;
  if (t.usage) {
    properties.inputTokens = t.usage.inputTokens;
    properties.outputTokens = t.usage.outputTokens;
    properties.totalTokens = t.usage.totalTokens;
  }
  if (t.rowCount !== undefined) properties.rowCount = t.rowCount;
  if (t.columnCount !== undefined) properties.columnCount = t.columnCount;
  if (t.openaiResponseId) properties.openaiResponseId = t.openaiResponseId;
  if (t.error) properties.error = t.error;
  if (t.refusalReason) properties.refusalReason = t.refusalReason;
  if (t.resultPreview) properties.resultPreview = t.resultPreview;

  const attachments = t.sql
    ? [{ type: "code", name: "generated_sql", value: t.sql, role: "output", language: "sql" }]
    : [];

  await post(EVENTS_URL, [
    {
      event_id: t.eventId,
      user_id: t.userId,
      event: EVENT_NAME,
      properties,
      attachments,
      ai_data: {
        model: t.model,
        input: t.question,
        // SQL when generated; for an out-of-scope refusal, the model's reason.
        output: t.sql ?? (t.refusalReason ? `cannot_answer: ${t.refusalReason}` : ""),
      },
    },
  ]);

  // Signals are the online mirror of the offline eval's executed/correct checks
  // (see tests/eval-helpers.ts) — only emitted for outcomes worth flagging.
  const signal = SIGNAL_FOR[t.outcome];
  if (signal) {
    await post(SIGNALS_URL, [
      {
        event_id: t.eventId,
        signal_name: signal.name,
        signal_type: "default",
        sentiment: signal.sentiment,
        ...(t.error ? { properties: { error: t.error } } : {}),
      },
    ]);
  }
}

/* -------------------------------------------------------------------------- */
/*  Eval-harness tracing — offline eval trials under a distinct event name     */
/* -------------------------------------------------------------------------- */

const EVAL_EVENT_NAME = "nl_to_sql_eval";
const EVAL_USER_ID = "eval-harness";

export interface EvalTraceInput {
  caseId: string;
  question: string;
  sql: string;
  model: string;
  mode: "constrained" | "unconstrained";
  parsed: boolean;
  executed: boolean;
  correct: boolean;
  generationMs: number;
  /** Trial index within the case (0-based). */
  trial: number;
  error?: string;
  /** Where the trial ran: the vitest harness (default) or the /evals page. */
  source?: "vitest" | "app";
}

/**
 * Trace one eval trial. Same event shape as a production request, but under a
 * distinct event name and a synthetic user so offline eval traffic stays
 * separable from real usage in the dashboard. Emits the per-axis failure
 * signals that mirror the suite's own assertions (parse / exec / correctness),
 * so the offline ground truth and the live signals share one taxonomy. No-op
 * without a write key.
 */
export async function traceEvalTrial(t: EvalTraceInput): Promise<void> {
  if (!isRaindropConfigured()) return;
  const eventId = newEventId();

  await post(EVENTS_URL, [
    {
      event_id: eventId,
      user_id: EVAL_USER_ID,
      event: EVAL_EVENT_NAME,
      properties: {
        caseId: t.caseId,
        mode: t.mode,
        model: t.model,
        parsed: t.parsed,
        executed: t.executed,
        correct: t.correct,
        generationMs: t.generationMs,
        trial: t.trial,
        source: t.source ?? "vitest",
        ...(t.error ? { error: t.error } : {}),
      },
      attachments: t.sql
        ? [{ type: "code", name: "generated_sql", value: t.sql, role: "output", language: "sql" }]
        : [],
      ai_data: { model: t.model, input: t.question, output: t.sql },
    },
  ]);

  // Per-axis failure signals — the online mirror of evals 1 & 2. A parse failure
  // is only meaningful in constrained mode (an unconstrained output landing
  // outside the grammar is expected — that's the whole point of eval 3).
  const failed: string[] = [];
  if (t.mode === "constrained" && !t.parsed) failed.push("eval_parse_failed");
  if (!t.executed) failed.push("eval_exec_failed");
  if (t.executed && !t.correct) failed.push("eval_incorrect");

  for (const name of failed) {
    await post(SIGNALS_URL, [
      {
        event_id: eventId,
        signal_name: name,
        signal_type: "default",
        sentiment: "NEGATIVE",
        properties: { caseId: t.caseId, mode: t.mode },
      },
    ]);
  }
}

/* -------------------------------------------------------------------------- */
/*  Edited-SQL tracing — the manual "edit & re-run" path (/api/execute)         */
/* -------------------------------------------------------------------------- */

export type ExecuteOutcome =
  | "ok"
  | "empty_result"
  | "execution_failed"
  | "unsafe_sql"
  | "invalid_request"
  | "rate_limited"
  | "not_configured";

const EXECUTE_EVENT_NAME = "sql_execute_edited";

const EXECUTE_SIGNAL_FOR: Record<ExecuteOutcome, string | null> = {
  ok: null,
  empty_result: "empty_result",
  execution_failed: "execution_failed",
  unsafe_sql: "unsafe_sql",
  invalid_request: "invalid_request",
  rate_limited: "rate_limited",
  not_configured: "service_not_configured",
};

export interface ExecuteTraceInput {
  eventId: string;
  userId: string;
  sql: string;
  outcome: ExecuteOutcome;
  executionMs?: number;
  rowCount?: number;
  columnCount?: number;
  error?: string;
  resultPreview?: ReadonlyArray<ReadonlyArray<unknown>>;
}

/**
 * Trace a manual "edit & re-run" from /api/execute — a human rewriting the
 * model's SQL and running it directly. That's a strong implicit signal (the
 * generated answer needed fixing) and the edited query is prime eval material,
 * so it gets its own event name to stay filterable from generated traffic.
 * No-op without a write key.
 */
export async function traceExecute(t: ExecuteTraceInput): Promise<void> {
  if (!isRaindropConfigured()) return;

  const properties: Record<string, unknown> = { outcome: t.outcome, edited: true };
  if (t.executionMs !== undefined) properties.executionMs = t.executionMs;
  if (t.rowCount !== undefined) properties.rowCount = t.rowCount;
  if (t.columnCount !== undefined) properties.columnCount = t.columnCount;
  if (t.error) properties.error = t.error;
  if (t.resultPreview) properties.resultPreview = t.resultPreview;

  await post(EVENTS_URL, [
    {
      event_id: t.eventId,
      user_id: t.userId,
      event: EXECUTE_EVENT_NAME,
      properties,
      attachments: t.sql
        ? [{ type: "code", name: "edited_sql", value: t.sql, role: "input", language: "sql" }]
        : [],
      ai_data: { input: t.sql, output: "" },
    },
  ]);

  const signal = EXECUTE_SIGNAL_FOR[t.outcome];
  if (signal) {
    await post(SIGNALS_URL, [
      {
        event_id: t.eventId,
        signal_name: signal,
        signal_type: "default",
        sentiment: "NEGATIVE",
        ...(t.error ? { properties: { error: t.error } } : {}),
      },
    ]);
  }
}
