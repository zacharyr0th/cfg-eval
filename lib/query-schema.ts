import { z } from "zod";

/**
 * Shape of the streamed NL→SQL result object.
 *
 * `/api/query` streams this object as a single *growing* JSON document, and the
 * `/query` page consumes it with the Vercel AI SDK's `useObject` hook, which
 * re-parses the accumulated text (partial JSON) on every chunk. Every field is
 * optional because the object lands in stages:
 *
 *   1. `sql` + `model` + `generationMs` + `usage` — as soon as GPT-5's
 *      grammar-constrained decode finishes.
 *   2. `columns` + `rows` + `executionMs` — once ClickHouse has run the query.
 *
 * On failure, `error` + `errorKind` are emitted instead of (or alongside, for
 * an execution error where the SQL is already known) the later stage.
 */
export const queryResultSchema = z.object({
  /** Raindrop event id for this request — echoed so the client can link to the trace. */
  eventId: z.string().optional(),
  sql: z.string().optional(),
  model: z.string().optional(),
  generationMs: z.number().optional(),
  executionMs: z.number().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
  columns: z.array(z.string()).optional(),
  rows: z.array(z.array(z.unknown())).optional(),
  cached: z.boolean().optional(),
  /**
   * The model declined via the `cannot_answer` tool — the question can't be
   * answered from the schema. No `sql`/`rows`; `refusalReason` says why. This is
   * a successful, intended outcome, not an error.
   */
  outOfScope: z.boolean().optional(),
  /** One-sentence reason for an `outOfScope` refusal. */
  refusalReason: z.string().optional(),
  /** Human-readable failure message, when a stage failed. */
  error: z.string().optional(),
  /** Machine-readable failure tag, e.g. `generation_failed`, `execution_failed`. */
  errorKind: z.string().optional(),
});

export type QueryResultObject = z.infer<typeof queryResultSchema>;
