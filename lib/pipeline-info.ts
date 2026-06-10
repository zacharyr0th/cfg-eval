import { DATASET } from "@/lib/schema";

/**
 * Client-safe description of the NL→SQL backend pipeline, surfaced in the /query
 * Trace sidebar so the architecture behind each answer is legible on screen.
 *
 * These mirror the server-side defaults in `lib/openai.ts` / `lib/nl-to-sql.ts`
 * (the env-overridable knobs) and the request flow in `app/api/query/route.ts`.
 * They're the *configured defaults* — a deployment that sets `OPENAI_*` env vars
 * can diverge; the per-turn trace always shows the real model that ran. Keep in
 * sync with those modules when the defaults change.
 */

export interface SetupFact {
  label: string;
  value: string;
  /** Longer explanation shown beneath the value, when it helps. */
  hint?: string;
  /** Render the value in a mono font (ids, table names, enums). */
  mono?: boolean;
}

/** The fixed configuration of the generation + execution pipeline. */
export const SETUP_FACTS: readonly SetupFact[] = [
  {
    label: "Mode",
    value: "Constrained decode",
    hint: "The model writes SQL inside a context-free grammar (CFG) — a strict whitelist of allowed SQL shapes — so invalid output is impossible by construction, not just discouraged.",
  },
  {
    label: "Model",
    value: "gpt-5",
    mono: true,
    hint: "The OpenAI model that turns the question into SQL. Default tier; OPENAI_MODEL can swap to gpt-5-mini / gpt-5-nano.",
  },
  {
    label: "Reasoning effort",
    value: "minimal",
    mono: true,
    hint: "How much hidden thinking the model does before answering. Minimal is safe here because the grammar already guarantees valid SQL — so answers come back faster and cheaper.",
  },
  {
    label: "Text verbosity",
    value: "low",
    mono: true,
    hint: "Caps how much extra prose the model writes around its answer. Only SQL is wanted, so: low.",
  },
  {
    label: "Max output",
    value: "4,096 tok",
    hint: "Upper bound on how much the model may generate per request — plenty for one SELECT query.",
  },
  {
    label: "Abstain tool",
    value: "cannot_answer",
    mono: true,
    hint: "An escape hatch: instead of forcing a nonsense query, the model can call cannot_answer to decline a question this dataset can't support.",
  },
  {
    label: "Guards",
    value: "SELECT-only · single table · 13 cols",
    hint: "What the grammar makes unwritable: only SELECT statements, only this one table, only 13 whitelisted columns. No joins, subqueries, CTEs, or semicolons can be produced.",
  },
  {
    label: "Engine",
    value: DATASET.engine,
    hint: "The database the generated SQL runs against.",
  },
  {
    label: "Table",
    value: DATASET.table,
    mono: true,
    hint: "The one table the grammar permits queries on.",
  },
  {
    label: "Range",
    value: `${DATASET.rangeStart} → ${DATASET.rangeEnd}`,
    mono: true,
    hint: `The dates the data covers — ${DATASET.rowCount}.`,
  },
  {
    label: "Cache",
    value: "In-memory LRU",
    hint: "Repeat questions replay a stored answer instantly — no model call, no database round-trip. (LRU = least-recently-used entries are evicted first.)",
  },
  {
    label: "Tracing",
    value: "Trace event",
    hint: "Every request is logged to an LLM observability dashboard, so each answer can be audited later.",
  },
] as const;
