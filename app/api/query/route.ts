import { after } from "next/server";
import { z } from "zod";
import { isOpenAIConfigured, MODEL_ID, REASONING_EFFORT } from "@/lib/openai";
import { isClickHouseConfigured, runQuery } from "@/lib/clickhouse";
import { generateSQLConstrained } from "@/lib/nl-to-sql";
import { assertSafeSelect } from "@/lib/sql-guard";
import { rateLimit } from "@/lib/rate-limit";
import { anonUserId, newEventId, traceQuery, type QueryOutcome, type TraceInput } from "@/lib/raindrop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/query — translates an NL question into a grammar-constrained SQL
 * query, runs it against `default.nyc_taxi`, and **streams** the result back as
 * a single growing JSON document for the Vercel AI SDK's `useObject` hook to
 * render progressively (shape: lib/query-schema.ts).
 *
 * The document is emitted in stages so the UI reveals the SQL the instant the
 * grammar-constrained decode finishes, then fills in the table once ClickHouse
 * has executed:
 *
 *   {                                            ← flushed immediately (TTFB)
 *     "sql": "...", "model": "...",              ← after GPT-5 + Lark CFG decode
 *     "generationMs": 1640, "usage": { ... },
 *     "columns": [...], "rows": [...],           ← after ClickHouse execution
 *     "executionMs": 38
 *   }
 *
 * Request:  { "question": "total fares on 2015-08-15" }
 *
 * Failures are surfaced as `error` + `errorKind` fields inside the (HTTP 200)
 * object rather than as status codes: `useObject` parses a 200 body into the
 * object but *throws* on a non-2xx, so one uniform 200 shape keeps the client's
 * error handling in a single place. The final accumulated body is always one
 * valid JSON object, so a non-streaming consumer calling `res.json()` still
 * works unchanged.
 */

const Body = z.object({
  question: z.string().trim().min(1, "question must be non-empty").max(1000),
});

// Per-caller cap. Each cache-miss request spends OpenAI tokens *and* a ClickHouse
// round-trip, so the route is gated before either is reached. The window is
// per-process (see lib/rate-limit.ts) — a best-effort abuse brake, not a quota.
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/**
 * Bounded in-memory response cache. The nyc_taxi dataset is static (2015-07..09),
 * so an identical question yields an identical answer — caching the full result
 * turns repeat questions (and the built-in demo scenarios) into instant,
 * zero-token hits, skipping both the GPT-5 call and the ClickHouse round-trip.
 * Keyed by model + question (different tiers emit different SQL). LRU by insertion
 * order, bounded so it can't grow without limit. Per process — resets on restart.
 * Evals bypass this route entirely, so pass@N sampling is unaffected.
 */
const CACHE_MAX = 256;
const responseCache = new Map<string, Record<string, unknown>>();

function cacheKey(question: string): string {
  return `${MODEL_ID}\n${question}`;
}

function cacheGet(key: string): Record<string, unknown> | undefined {
  const hit = responseCache.get(key);
  if (hit) {
    responseCache.delete(key); // re-insert to refresh LRU recency
    responseCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: Record<string, unknown>): void {
  responseCache.set(key, value);
  if (responseCache.size > CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
}

/**
 * Incrementally writes one JSON object to a stream controller, one field at a
 * time, so the accumulated text the client has seen is always partial-JSON-
 * parseable (that's exactly what `useObject` re-parses on every chunk). Fields
 * append in call order; `undefined` values are skipped (emitting `"k":undefined`
 * would corrupt the document). `field()`/`end()` are no-ops once ended, so an
 * error path can't race a normal `end()` into a double-close.
 */
class JsonObjectStreamer {
  private readonly enc = new TextEncoder();
  private opened = false;
  private hasField = false;
  private ended = false;

  constructor(private readonly controller: ReadableStreamDefaultController<Uint8Array>) {}

  private emit(s: string) {
    this.controller.enqueue(this.enc.encode(s));
  }

  /** Flush the opening brace so the client sees `{}` and the stream's TTFB starts early. */
  open() {
    if (this.opened) return;
    this.emit("{");
    this.opened = true;
  }

  field(key: string, value: unknown) {
    if (this.ended || value === undefined) return;
    this.open();
    this.emit(`${this.hasField ? "," : ""}${JSON.stringify(key)}:${JSON.stringify(value)}`);
    this.hasField = true;
  }

  end() {
    if (this.ended) return;
    this.open();
    this.emit("}");
    this.ended = true;
    this.controller.close();
  }
}

const STREAM_HEADERS = {
  // text/plain (not application/json) so no proxy buffers the growing document
  // waiting for "complete" JSON — `useObject` reads the raw text stream anyway.
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
} as const;

/** A complete object in one shot — cache hits and pre-flight (pre-stream) errors. */
function jsonResponse(obj: Record<string, unknown>): Response {
  return new Response(JSON.stringify(obj), { headers: STREAM_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  // One Raindrop event per request. We register the `after()` callback up front,
  // in the request scope where Next's async context is live, and have it read a
  // mutable slot filled in once the outcome is known (possibly inside the stream,
  // which runs after this handler returns). This keeps tracing off the response's
  // critical path and out of the streaming controller's (context-less) scope.
  // Set up *before* the guard checks so every outcome — including a missing-key
  // 503 or a bad request — produces exactly one traced event.
  const eventId = newEventId();
  const userId = anonUserId(req);
  const traceDefaults = {
    eventId,
    userId,
    model: MODEL_ID,
    mode: "constrained" as const,
    reasoningEffort: REASONING_EFFORT,
    cached: false,
    sql: null,
  };
  let pendingTrace: TraceInput | null = null;
  const record = (extra: Partial<TraceInput> & { outcome: QueryOutcome; question: string }) => {
    pendingTrace = { ...traceDefaults, ...extra };
  };
  after(() => (pendingTrace ? traceQuery(pendingTrace) : undefined));

  if (!isOpenAIConfigured()) {
    record({ question: "", outcome: "not_configured", error: "missing_openai_key" });
    return jsonResponse({
      eventId,
      errorKind: "missing_openai_key",
      error: "Set OPENAI_API_KEY in .env.local and restart.",
    });
  }
  if (!isClickHouseConfigured()) {
    record({ question: "", outcome: "not_configured", error: "missing_clickhouse_config" });
    return jsonResponse({
      eventId,
      errorKind: "missing_clickhouse_config",
      error: "Set CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD in .env.local and restart.",
    });
  }

  let question: string;
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
    question = Body.parse(rawBody).question;
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message ?? "invalid body" : "invalid JSON";
    const attempted =
      rawBody && typeof (rawBody as { question?: unknown }).question === "string"
        ? (rawBody as { question: string }).question.slice(0, 1000)
        : "";
    record({ question: attempted, outcome: "invalid_request", error: message });
    return jsonResponse({ eventId, errorKind: "bad_request", error: message });
  }

  // Gate before the cache lookup so the limiter can't be bypassed by replaying a
  // cached question, and before any OpenAI/ClickHouse work on a miss.
  const limit = rateLimit(`query:${userId}`, RATE_LIMIT);
  if (!limit.ok) {
    // In-body error at HTTP 200, same as the missing-key guards above — keeps the
    // client's error handling in one place (onFinish, not onError). The wait is
    // surfaced in the body so the UI can tell the user when to retry.
    record({ question, outcome: "rate_limited", error: "rate_limited" });
    return jsonResponse({
      eventId,
      errorKind: "rate_limited",
      error: `Too many requests — try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const key = cacheKey(question);
  const cached = cacheGet(key);
  if (cached) {
    // A cache hit is a real, zero-token request — trace it (cached: true), but
    // don't report the original generation's tokens/latency as if spent now.
    if (cached.outOfScope) {
      record({
        question,
        outcome: "out_of_scope",
        cached: true,
        refusalReason: cached.refusalReason as string | undefined,
      });
    } else {
      const rows = (cached.rows as unknown[][]) ?? [];
      const columns = (cached.columns as unknown[]) ?? [];
      record({
        question,
        outcome: rows.length === 0 ? "empty_result" : "ok",
        cached: true,
        sql: (cached.sql as string | undefined) ?? null,
        rowCount: rows.length,
        columnCount: columns.length,
        resultPreview: rows.slice(0, 5),
      });
    }
    return jsonResponse({ ...cached, cached: true, eventId });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const out = new JsonObjectStreamer(controller);
      out.open();
      // Emit the trace id first so the client can link to this exact event
      // even before the SQL or rows have streamed in.
      out.field("eventId", eventId);

      let generation: Awaited<ReturnType<typeof generateSQLConstrained>>;
      try {
        generation = await generateSQLConstrained(question);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        record({ question, outcome: "generation_failed", error: message });
        out.field("errorKind", "generation_failed");
        out.field("error", message);
        out.end();
        return;
      }

      // The model chose the abstain tool: the question can't be answered from the
      // schema. Surface that as a first-class out-of-scope result — not a fake
      // number, not an error — and cache it (the refusal is as deterministic as
      // an answer would be). No ClickHouse round-trip.
      if (generation.kind === "refusal") {
        out.field("model", generation.model);
        out.field("generationMs", generation.latencyMs);
        out.field("usage", generation.usage);
        out.field("outOfScope", true);
        out.field("refusalReason", generation.reason);
        out.end();
        cacheSet(key, {
          model: generation.model,
          generationMs: generation.latencyMs,
          usage: generation.usage,
          outOfScope: true,
          refusalReason: generation.reason,
        });
        record({
          question,
          outcome: "out_of_scope",
          generationMs: generation.latencyMs,
          usage: generation.usage,
          openaiResponseId: generation.responseId,
          refusalReason: generation.reason,
        });
        return;
      }

      out.field("sql", generation.sql);
      out.field("model", generation.model);
      out.field("generationMs", generation.latencyMs);
      out.field("usage", generation.usage);

      const execStart = Date.now();
      try {
        // Defense in depth: the grammar fixes the statement shape and a
        // whitelist-only projection, but its IDENTIFIER fallback (needed so
        // aliases can be referenced in GROUP BY / ORDER BY / HAVING) can let a
        // geo column slip into a predicate. Re-assert the same envelope the edit
        // path uses so "single-table SELECT, no geo" holds for generated SQL too
        // — not just hand-edited SQL. On conformant SQL this is a no-op.
        const result = await runQuery(assertSafeSelect(generation.sql));
        const executionMs = Date.now() - execStart;
        out.field("columns", result.columns);
        out.field("rows", result.rows);
        out.field("executionMs", executionMs);
        out.end();
        cacheSet(key, {
          sql: generation.sql,
          model: generation.model,
          generationMs: generation.latencyMs,
          usage: generation.usage,
          columns: result.columns,
          rows: result.rows,
          executionMs,
        });
        record({
          question,
          outcome: result.rows.length === 0 ? "empty_result" : "ok",
          sql: generation.sql,
          generationMs: generation.latencyMs,
          executionMs,
          usage: generation.usage,
          rowCount: result.rows.length,
          columnCount: result.columns.length,
          openaiResponseId: generation.responseId,
          resultPreview: result.rows.slice(0, 5),
        });
      } catch (e) {
        // The grammar guarantees ClickHouse-syntactic SQL, so an error here is
        // semantically meaningful (date out of range, etc.). `sql` is already in
        // the stream, so the client can show it alongside the error.
        const message = e instanceof Error ? e.message : String(e);
        record({
          question,
          outcome: "execution_failed",
          sql: generation.sql,
          generationMs: generation.latencyMs,
          usage: generation.usage,
          openaiResponseId: generation.responseId,
          error: message,
        });
        out.field("errorKind", "execution_failed");
        out.field("error", message);
        out.end();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
