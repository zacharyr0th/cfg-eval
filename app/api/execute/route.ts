import { NextResponse, after } from "next/server";
import { z } from "zod";
import { isClickHouseConfigured, runQuery } from "@/lib/clickhouse";
import { assertSafeSelect } from "@/lib/sql-guard";
import { rateLimit } from "@/lib/rate-limit";
import {
  anonUserId,
  newEventId,
  traceExecute,
  type ExecuteOutcome,
  type ExecuteTraceInput,
} from "@/lib/raindrop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/execute — run an *edited* SQL query directly, skipping generation.
 *
 * Powers the "edit & re-run" affordance on /query. The SQL here is arbitrary
 * user input (not grammar-constrained), so it passes through `assertSafeSelect`
 * and runs `readonly` against ClickHouse. There's no model call and no cache —
 * this path is purely "execute exactly what the user typed, safely".
 *
 * Request:  { "sql": "SELECT count() FROM nyc_taxi" }
 * Response (200): { sql, executionMs, columns, rows, edited: true }
 * Failures: 400 invalid/unsafe SQL, 503 missing CH config, 502 CH error.
 */

const Body = z.object({
  sql: z.string().trim().min(1, "sql must be non-empty").max(4000),
});

// Per-caller cap on the arbitrary-SQL path. Per-process best-effort brake — see
// lib/rate-limit.ts. Slightly looser than /api/query (no OpenAI spend here).
const RATE_LIMIT = { limit: 40, windowMs: 60_000 };

export async function POST(req: Request) {
  // Trace this edited-SQL execution to Raindrop from after(), reading a slot
  // filled in once the outcome is known — same pattern as /api/query, so a
  // human "edit & re-run" lands as its own filterable event with the right
  // outcome (and signal) for every path below.
  const eventId = newEventId();
  const userId = anonUserId(req);
  let pending: ExecuteTraceInput | null = null;
  const record = (extra: Partial<ExecuteTraceInput> & { outcome: ExecuteOutcome }) => {
    pending = { eventId, userId, sql: "", ...extra };
  };
  after(() => (pending ? traceExecute(pending) : undefined));

  if (!isClickHouseConfigured()) {
    record({ outcome: "not_configured", error: "missing_clickhouse_config" });
    return NextResponse.json(
      {
        error: "missing_clickhouse_config",
        message: "Set CLICKHOUSE_HOST and CLICKHOUSE_PASSWORD in .env.local and restart.",
        eventId,
      },
      { status: 503 },
    );
  }

  const limit = rateLimit(`execute:${userId}`, RATE_LIMIT);
  if (!limit.ok) {
    record({ outcome: "rate_limited", error: "rate_limited" });
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests — slow down and try again shortly.", eventId },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let parsed: z.infer<typeof Body>;
  let rawBody: unknown = null;
  try {
    rawBody = await req.json();
    parsed = Body.parse(rawBody);
  } catch (e) {
    const message = e instanceof z.ZodError ? e.issues[0]?.message ?? "invalid body" : "invalid JSON";
    const attempted =
      rawBody && typeof (rawBody as { sql?: unknown }).sql === "string"
        ? (rawBody as { sql: string }).sql.slice(0, 4000)
        : "";
    record({ outcome: "invalid_request", sql: attempted, error: message });
    return NextResponse.json({ error: "bad_request", message, eventId }, { status: 400 });
  }

  let sql: string;
  try {
    sql = assertSafeSelect(parsed.sql);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    record({ outcome: "unsafe_sql", sql: parsed.sql, error: message });
    return NextResponse.json({ error: "unsafe_sql", message, eventId }, { status: 400 });
  }

  const execStart = Date.now();
  try {
    const result = await runQuery(sql, { readonly: true });
    const executionMs = Date.now() - execStart;
    record({
      outcome: result.rows.length === 0 ? "empty_result" : "ok",
      sql,
      executionMs,
      rowCount: result.rows.length,
      columnCount: result.columns.length,
      resultPreview: result.rows.slice(0, 5),
    });
    return NextResponse.json({
      sql,
      executionMs,
      columns: result.columns,
      rows: result.rows,
      edited: true,
      eventId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    record({ outcome: "execution_failed", sql, error: message });
    return NextResponse.json({ error: "execution_failed", message, sql, eventId }, { status: 502 });
  }
}
