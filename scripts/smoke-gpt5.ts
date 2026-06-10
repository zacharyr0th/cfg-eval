/**
 * Smoke-test the GPT-5 + CFG path end-to-end:
 *   1. Build the custom-tool grammar request.
 *   2. Send a single NL question.
 *   3. Inspect the raw Responses output to confirm the SDK surface.
 *
 * Run from project root:
 *   bun run scripts/smoke-gpt5.ts
 */

import "../tests/setup-env";

import OpenAI from "openai";
import { NYC_TAXI_LARK, NYC_TAXI_SCHEMA_DESCRIPTION } from "../lib/grammar/taxi";

const QUESTION =
  process.argv[2] ??
  "What were the total fares collected on 2015-08-15?";

const SYSTEM = `
You translate the user's natural-language question into a single ClickHouse SELECT statement against the nyc_taxi table and emit it via the execute_sql tool.

${NYC_TAXI_SCHEMA_DESCRIPTION}

Grammar constraints:
- Use UPPERCASE for SQL keywords (SELECT, FROM, WHERE, GROUP BY, ORDER BY, HAVING, LIMIT, AND, OR, IN, BETWEEN, IS, NULL, NOT, AS, ASC, DESC).
- Only reference the whitelisted columns above. Do not reference lat/long.
- No semicolons. No comments. No CTEs / subqueries / joins.

Always emit one valid SELECT. Aim for the minimal query that answers the question.
`.trim();

async function main() {
  const client = new OpenAI();
  const start = Date.now();
  const res = await client.responses.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5",
    input: [
      { role: "system", content: SYSTEM },
      { role: "user", content: QUESTION },
    ],
    tools: [
      {
        type: "custom",
        name: "execute_sql",
        description: [
          "Execute one ClickHouse SELECT query against default.nyc_taxi to answer the question.",
          "The CFG accepts: a single SELECT; FROM nyc_taxi (or default.nyc_taxi) only — no joins, no subqueries, no CTEs, no UNION;",
          "13 whitelisted columns (no lat/long); aggregates count/sum/avg/min/max/uniq/uniqExact;",
          "date functions toDate/toHour/toStartOfDay/toStartOfHour/toStartOfMonth/toDayOfWeek/toMonth/toYear;",
          "WHERE/GROUP BY/HAVING/ORDER BY/LIMIT clauses; UPPERCASE keywords; no semicolons; no comments.",
          "YOU MUST REASON HEAVILY ABOUT THE QUERY AND MAKE SURE IT OBEYS THE GRAMMAR before emitting it.",
        ].join(" "),
        format: { type: "grammar", syntax: "lark", definition: NYC_TAXI_LARK },
      },
    ],
    tool_choice: { type: "custom", name: "execute_sql" },
    // Custom tool type does NOT support parallel tool calling (cookbook §2.1).
    parallel_tool_calls: false,
    // Cap output budget (reasoning + SQL); minimize reasoning + verbosity for
    // a single SELECT. See lib/openai.ts for rationale + env overrides.
    max_output_tokens: 4096,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
  });

  const elapsed = Date.now() - start;
  console.log("--- elapsed:", elapsed, "ms");
  console.log("--- response (JSON, first 4kb) ---");
  const s = JSON.stringify(res, null, 2);
  console.log(s.length > 4000 ? s.slice(0, 4000) + "\n... (truncated)" : s);
}

main().catch((e) => {
  console.error("smoke failed:", e);
  process.exit(1);
});
