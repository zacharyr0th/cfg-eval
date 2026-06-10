import "server-only";
import type OpenAI from "openai";
import {
  openai,
  MODEL_ID,
  MAX_OUTPUT_TOKENS,
  REASONING_EFFORT,
  TEXT_VERBOSITY,
} from "@/lib/openai";
import { NYC_TAXI_LARK, NYC_TAXI_SCHEMA_DESCRIPTION } from "@/lib/grammar/taxi";

/**
 * NL → ClickHouse SQL, two modes:
 *
 *   - `generateSQLConstrained` — GPT-5 Responses API with TWO tools: a custom
 *     tool whose `format` is the Lark grammar (the model's SQL decode is provably
 *     grammar-conformant by construction), and a `cannot_answer` tool it calls
 *     instead when the question can't be answered from the schema. With
 *     `tool_choice: "required"` the model must call exactly one — so an
 *     out-of-scope prompt yields an honest refusal, not a degenerate query the
 *     grammar was forced to manufacture.
 *   - `generateSQLUnconstrained` — same model, same system prompt, NO grammar
 *     and no abstain tool. The model emits SQL as plain text. Used only as the
 *     head-to-head baseline in eval #3 ("what does CFG actually buy us?").
 *
 * Both paths share the same `SYSTEM_PROMPT`; the constrained path adds a short
 * tool-usage suffix and the abstain tool. For answerable prompts the manipulated
 * variable is still just the grammar constraint — the abstain tool only changes
 * behaviour on the out-of-scope set (eval #5).
 */

const TOOL_NAME = "execute_sql";

// Per OpenAI's GPT-5 CFG cookbook §3.5: spell out what the grammar accepts
// and instruct the model to reason heavily about compliance. The grammar is
// the load-bearing constraint at decode time; the description is what the
// model uses to plan a query that the constraint will accept without drift.
const TOOL_DESCRIPTION = [
  "Execute one ClickHouse SELECT query against default.nyc_taxi to answer the user's question.",
  "The CFG accepts: a single SELECT statement; FROM nyc_taxi (or default.nyc_taxi) only — no joins, no subqueries, no CTEs, no UNION;",
  "the 13 whitelisted columns (trip_id, pickup_datetime, dropoff_datetime, passenger_count, trip_distance, fare_amount, extra, tip_amount, tolls_amount, total_amount, payment_type, pickup_ntaname, dropoff_ntaname — lat/long are NOT accepted);",
  "the aggregates count / sum / avg / min / max / uniq / uniqExact; the date functions toDate, toHour, toStartOfDay, toStartOfHour, toStartOfMonth, toDayOfWeek, toMonth, toYear;",
  "WHERE / GROUP BY / HAVING / ORDER BY / LIMIT clauses; comparisons between two arithmetic expressions (column-vs-column and ratios like tip_amount / fare_amount > 0.2 are allowed) plus [NOT] IN / [NOT] BETWEEN / IS [NOT] NULL / NOT (...) predicates; UPPERCASE SQL keywords; no semicolons, no comments.",
  "CRITICAL — projection rule: every column in SELECT must be inside an aggregate or in GROUP BY.",
  "For ratio averages, arithmetic goes INSIDE the aggregate: avg(tip_amount / fare_amount), NOT avg(tip_amount) / fare_amount.",
  "The grammar accepts both forms, but ClickHouse rejects the second (mixing aggregate and non-aggregate without GROUP BY).",
  "YOU MUST REASON HEAVILY ABOUT THE QUERY AND MAKE SURE IT OBEYS THE GRAMMAR before emitting it.",
].join(" ");

const REFUSAL_TOOL_NAME = "cannot_answer";

// The abstain tool. The grammar guarantees valid SQL but can't refuse — so a
// question the schema can't answer would otherwise be forced into a degenerate
// query and rendered as a confident number. This gives the model a legal way to
// decline instead, which is the whole point of the out-of-scope path.
const REFUSAL_TOOL_DESCRIPTION = [
  "Call this INSTEAD of execute_sql when the question can't be faithfully answered from the nyc_taxi columns —",
  "it needs data the table doesn't contain (weather, driver/passenger identity, vehicle make/model, pickup/dropoff latitude-longitude, fare predictions, anything outside the 13 whitelisted columns), or it isn't about the trip data at all.",
  "Give a one-sentence reason naming what's missing.",
  "Do NOT emit a degenerate query (a bare count, SELECT 1, etc.) just to satisfy the grammar — decline here instead.",
].join(" ");

const SYSTEM_PROMPT = `
You translate the user's natural-language question into a single ClickHouse SELECT statement against the nyc_taxi table.

${NYC_TAXI_SCHEMA_DESCRIPTION}

Grammar constraints:
- Use UPPERCASE for SQL keywords (SELECT, FROM, WHERE, GROUP BY, ORDER BY, HAVING, LIMIT, AND, OR, IN, BETWEEN, IS, NULL, NOT, AS, ASC, DESC).
- Only reference the whitelisted columns above. Do not reference lat/long columns.
- No semicolons. No comments. No CTEs / subqueries / joins.
- Single SELECT statement only.
- Every column in SELECT must be inside an aggregate (count/sum/avg/min/max) or appear in GROUP BY.
- For ratio averages, nest the division INSIDE avg: avg(tip_amount / fare_amount) — never avg(tip_amount) / fare_amount. Both parse the grammar; only the first executes on ClickHouse.

Aim for the minimal query that answers the question. If the question references a date or date range, use the literal strings in the data's actual range (2015-07-01 through 2015-09-30).
`.trim();

/**
 * Appended to SYSTEM_PROMPT for the constrained path ONLY. The shared prompt
 * stays byte-identical across both modes so the head-to-head (eval #7) still
 * isolates the grammar as the manipulated variable for *answerable* questions;
 * this suffix only explains the two tools the constrained model has and the
 * unconstrained one doesn't.
 */
const CONSTRAINED_ABSTAIN_GUIDANCE = `
You have two tools and must call exactly one:
- execute_sql — emit a single grammar-constrained SELECT that answers the question.
- cannot_answer — decline, with a brief reason, when the question can't be answered from the columns above.

Prefer execute_sql whenever the question maps to the available columns. Reach for cannot_answer only when answering would require data the schema doesn't have (weather, driver/passenger identity, vehicle, lat/long, etc.) — never emit a meaningless query just to produce output.
`.trim();

export type Mode = "constrained" | "unconstrained";

interface NLToSQLBase {
  /** "constrained" (CFG via custom tool) or "unconstrained" (plain Responses output). */
  mode: Mode;
  /** Model id actually called. */
  model: string;
  /** End-to-end wall-clock time, ms. */
  latencyMs: number;
  /** Input + output tokens reported by the API. */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Raw OpenAI response id for cross-referencing dashboard logs. */
  responseId: string;
}

/** The model emitted SQL. For constrained mode, guaranteed grammar-conformant. */
interface NLToSQLSql extends NLToSQLBase {
  kind: "sql";
  sql: string;
}

/**
 * Constrained mode only: the model called `cannot_answer` instead of the grammar
 * tool, declining a question the nyc_taxi schema can't faithfully answer. This is
 * the abstain path that stops the grammar from manufacturing a degenerate query
 * for an out-of-scope prompt and presenting it as an answer.
 */
interface NLToSQLRefusal extends NLToSQLBase {
  kind: "refusal";
  reason: string;
}

export type NLToSQLResult = NLToSQLSql | NLToSQLRefusal;

function readUsage(usage: OpenAI.Responses.ResponseUsage | undefined): NLToSQLResult["usage"] {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? (usage ? usage.input_tokens + usage.output_tokens : 0),
  };
}

type ConstrainedDecode = { kind: "sql"; sql: string } | { kind: "refusal"; reason: string };

const DEFAULT_REFUSAL = "This question can't be answered from the nyc_taxi schema.";

/** The `cannot_answer` arguments are strict JSON `{ reason }`; fall back if malformed. */
function parseRefusalReason(args: string): string {
  try {
    const parsed = JSON.parse(args) as { reason?: unknown };
    if (typeof parsed.reason === "string" && parsed.reason.trim()) return parsed.reason.trim();
  } catch {
    // malformed tool arguments — use the generic reason
  }
  return DEFAULT_REFUSAL;
}

/**
 * Pull the constrained decode out of the Responses output. With `tool_choice:
 * "required"` over two tools, the model emits exactly one tool call: either the
 * grammar `execute_sql` custom tool (its `input` is grammar-conformant SQL) or
 * the `cannot_answer` function tool (its `arguments` carry the refusal reason).
 * The v6 SDK types `output` as a discriminated union, so the `type` guards narrow
 * each item to the right call shape.
 */
function extractConstrainedDecode(
  output: OpenAI.Responses.ResponseOutputItem[],
): ConstrainedDecode | null {
  for (const item of output) {
    if (item.type === "custom_tool_call" && item.name === TOOL_NAME) {
      const sql = item.input.trim();
      if (sql.length > 0) return { kind: "sql", sql };
    }
    if (item.type === "function_call" && item.name === REFUSAL_TOOL_NAME) {
      return { kind: "refusal", reason: parseRefusalReason(item.arguments) };
    }
  }
  return null;
}

/** Strip a leading/trailing ```sql fence if the model wrapped its answer. */
function unfence(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```(?:sql)?\s*([\s\S]*?)\s*```$/i);
  return (fence ? fence[1] : t).trim();
}

export async function generateSQLConstrained(question: string): Promise<NLToSQLResult> {
  const start = Date.now();
  const res = await openai.responses.create({
    model: MODEL_ID,
    input: [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${CONSTRAINED_ABSTAIN_GUIDANCE}` },
      { role: "user", content: question },
    ],
    tools: [
      {
        type: "custom",
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        format: { type: "grammar", syntax: "lark", definition: NYC_TAXI_LARK },
      },
      {
        type: "function",
        name: REFUSAL_TOOL_NAME,
        description: REFUSAL_TOOL_DESCRIPTION,
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: {
            reason: {
              type: "string",
              description: "One sentence naming the data the nyc_taxi schema lacks to answer this.",
            },
          },
        },
      },
    ],
    // Two tools, exactly one call: the grammar decode when the question is
    // answerable, else the abstain tool. `required` (not a pinned tool) is what
    // restores the choice the old forced `tool_choice` removed — the model can
    // now decline instead of being compelled to emit SQL.
    tool_choice: "required",
    // Custom tool type does NOT support parallel tool calling (cookbook §2.1).
    // Set explicitly so the request is unambiguous even if SDK defaults change.
    parallel_tool_calls: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: REASONING_EFFORT },
    text: { verbosity: TEXT_VERBOSITY },
    // The prefix (system prompt + tools) is byte-identical across every run — a
    // fixed cache key routes them to the same cached-prefix slot for an automatic
    // input-token discount and lower TTFT. Bumped to v3: the prefix changed when
    // the grammar gained expression comparisons / NOT predicates and the tool
    // description was updated to match.
    prompt_cache_key: "nl-to-sql:constrained:v4",
  });
  const decode = extractConstrainedDecode(res.output);
  if (!decode) {
    throw new Error(`constrained run did not produce a tool call (response id ${res.id})`);
  }
  const base = {
    mode: "constrained" as const,
    model: MODEL_ID,
    latencyMs: Date.now() - start,
    usage: readUsage(res.usage),
    responseId: res.id,
  };
  return decode.kind === "sql"
    ? { ...base, kind: "sql", sql: decode.sql }
    : { ...base, kind: "refusal", reason: decode.reason };
}

export async function generateSQLUnconstrained(question: string): Promise<NLToSQLResult> {
  const start = Date.now();
  const res = await openai.responses.create({
    model: MODEL_ID,
    input: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nOutput ONLY the SQL — no prose, no fences, no explanation.`,
      },
      { role: "user", content: question },
    ],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: REASONING_EFFORT },
    text: { verbosity: TEXT_VERBOSITY },
    // Distinct key from the constrained path — the system prompt differs (the
    // "output ONLY the SQL" suffix), so it's a separate cacheable prefix.
    prompt_cache_key: "nl-to-sql:unconstrained:v1",
  });
  const sql = unfence(res.output_text);
  if (!sql) {
    throw new Error(`unconstrained run did not produce any output text (response id ${res.id})`);
  }
  return {
    kind: "sql",
    sql,
    mode: "unconstrained",
    model: MODEL_ID,
    latencyMs: Date.now() - start,
    usage: readUsage(res.usage),
    responseId: res.id,
  };
}

export async function generateSQL(question: string, mode: Mode): Promise<NLToSQLResult> {
  return mode === "constrained"
    ? generateSQLConstrained(question)
    : generateSQLUnconstrained(question);
}
