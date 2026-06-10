/** Shared client types for a query run and its failure shape. */

export interface QueryResult {
  sql: string;
  columns: string[];
  rows: unknown[][];
  /** Absent until ClickHouse finishes (e.g. mid-stream execution phase). */
  executionMs?: number;
  /** Present only for generated (non-edited) runs. */
  model?: string;
  generationMs?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Served from the API's in-memory response cache. */
  cached?: boolean;
  /** Produced by /api/execute from user-edited SQL (bypassed generation). */
  edited?: boolean;
}
