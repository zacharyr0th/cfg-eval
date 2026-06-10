import "server-only";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

/**
 * ClickHouse Cloud client + a typed `runQuery` helper.
 *
 * Connection details come from env (`CLICKHOUSE_HOST` / `_PORT` / `_USER` /
 * `_PASSWORD` / `_DATABASE`). We construct exactly one client per server
 * process — the underlying HTTP keep-alive pool handles concurrency.
 *
 * Usage:
 *   const result = await runQuery("SELECT count() FROM trips")
 *   result.columns  // ["count()"]
 *   result.rows     // [[42]]
 */

export interface QueryResult {
  columns: string[];
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Server-side query duration in milliseconds, as reported by ClickHouse. */
  serverElapsedMs?: number;
}

let _client: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (_client) return _client;
  const host = process.env.CLICKHOUSE_HOST?.trim();
  const port = process.env.CLICKHOUSE_PORT?.trim() || "8443";
  const username = process.env.CLICKHOUSE_USER?.trim() || "default";
  const password = process.env.CLICKHOUSE_PASSWORD?.trim() ?? "";
  const database = process.env.CLICKHOUSE_DATABASE?.trim();
  if (!host) {
    throw new Error("CLICKHOUSE_HOST is not set — add it to .env.local");
  }
  // CH Cloud is HTTPS on 8443; the client infers the protocol from the URL.
  _client = createClient({
    url: `https://${host}:${port}`,
    username,
    password,
    database,
    // Modest timeout keeps the API route from hanging if a query is bad — the
    // grammar prevents most pathological queries but a heavy aggregate over the
    // full taxi table is still possible.
    request_timeout: 30_000,
  });
  return _client;
}

export function isClickHouseConfigured(): boolean {
  return Boolean(process.env.CLICKHOUSE_HOST?.trim() && process.env.CLICKHOUSE_PASSWORD?.trim());
}

/**
 * Execute a SELECT statement. Returns column metadata + rows. Throws on any
 * ClickHouse-side error (syntax, missing table, etc.) — callers decide whether
 * to surface to the user.
 *
 * `opts.readonly` adds `readonly=2` (reads + per-query settings allowed, no
 * writes/DDL) as a server-side backstop for the "edit & re-run" escape hatch,
 * where the SQL is arbitrary user input rather than grammar-constrained output.
 */
export async function runQuery(sql: string, opts: { readonly?: boolean } = {}): Promise<QueryResult> {
  const client = getClient();
  const result = await client.query({
    query: sql,
    format: "JSONCompactEachRowWithNamesAndTypes",
    // Server-side guards. runQuery buffers the whole response into a string
    // before splitting, so an unbounded result set could OOM the process: cap
    // rows (and `throw` rather than silently `break` — a truncated result would
    // read as a wrong answer in the evals), and bound wall-clock so a heavy
    // aggregate over the full table can't hang the API route past its own
    // 30s request timeout. Normal analytics queries here return a handful of
    // rows in well under a second, so neither guard touches the real path.
    clickhouse_settings: {
      max_execution_time: 30,
      max_result_rows: "100000",
      result_overflow_mode: "throw",
      // readonly=2 (not 1) so the guards above can still be applied per-query.
      ...(opts.readonly ? { readonly: "2" as const } : {}),
    },
  });
  // JSONCompactEachRowWithNamesAndTypes streams: [names], [types], ...rows.
  const lines = (await result.text()).split("\n").filter(Boolean);
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = JSON.parse(lines[0]) as string[];
  // We skip the types line (lines[1]) — could surface them later for typed
  // formatting in the UI, but raw stringification is fine for v1.
  const rows = lines.slice(2).map((line) => JSON.parse(line) as unknown[]);
  return { columns, rows };
}

/**
 * Lightweight liveness check for the connection-status indicator. Returns false
 * (never throws) on any error so the UI can render a "degraded" dot rather than
 * crash. Cheap — the client's `/ping` endpoint, not a query.
 */
export async function pingClickHouse(): Promise<boolean> {
  try {
    const res = await getClient().ping();
    return res.success === true;
  } catch {
    return false;
  }
}
