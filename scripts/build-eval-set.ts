/**
 * Build candidate eval cases from real traced traffic — closing the loop.
 *
 * The offline eval set (tests/eval-cases.ts) is only as good as the prompts in
 * it. Production requests that earned a NEGATIVE signal — execution_failed,
 * empty_result, or an eval miss — are exactly the prompts it's
 * missing. This pulls them back out of Raindrop via the Query (read) API and
 * prints them as `EvalCase` scaffolds to paste into tests/eval-cases.ts. You
 * still hand-write `referenceSQL` (that's the ground truth the suite compares
 * against); the model's own SQL is shown as a comment — it's the suspect, not
 * the answer.
 *
 * Usage (the QUERY/read key is distinct from the RAINDROP_WRITE_KEY ingestion
 * key — both at https://auth.raindrop.ai/org/api_keys):
 *
 *   RAINDROP_QUERY_API_KEY=… bun run scripts/build-eval-set.ts
 *   RAINDROP_QUERY_API_KEY=… LIMIT=100 bun run scripts/build-eval-set.ts
 *
 * Exit codes: 0 ok · 1 runtime error · 2 missing key.
 */
import { RaindropQuery } from "@raindrop-ai/query";

const KEY = process.env.RAINDROP_QUERY_API_KEY?.trim();
if (!KEY) {
  console.error("Set RAINDROP_QUERY_API_KEY (the Query/read key) to run this.");
  process.exit(2);
}

// The negative signals worth turning into regression cases. Edit to taste — run
// once with no matches and the script prints the signals your org actually has.
const TARGET_SIGNALS = new Set([
  "execution_failed",
  "empty_result",
  "eval_incorrect",
  "eval_exec_failed",
]);
const LIMIT = Number(process.env.LIMIT ?? "50");

const client = new RaindropQuery({ apiKey: KEY });

/** A stable, readable case id from the question text. */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "case"
  );
}

async function main(): Promise<void> {
  const allSignals = await client.signals.list({ limit: 200 });
  const wanted = allSignals.data.filter((s) => TARGET_SIGNALS.has(s.name));

  if (wanted.length === 0) {
    console.error("No matching signals found. Signals available in this org:");
    for (const s of allSignals.data) console.error(`  - ${s.name} (${s.type})`);
    console.error("\nEdit TARGET_SIGNALS in this script to match one of the above.");
    return;
  }

  const seen = new Set<string>();
  const cases: Array<{ id: string; question: string; sql: string | null; signal: string }> = [];

  for (const sig of wanted) {
    const events = await client.events.list({ signal: sig.id, limit: LIMIT });
    for (const ev of events.data) {
      const question = ev.userInput?.trim();
      if (!question) continue; // not_configured / invalid_request events carry no prompt
      const dedupeKey = question.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      cases.push({
        id: slug(question),
        question,
        sql: ev.assistantOutput?.trim() || null,
        signal: sig.name,
      });
    }
  }

  if (cases.length === 0) {
    console.error("Matching signals exist, but no events with a user prompt were returned.");
    return;
  }

  console.log(
    `// ${cases.length} candidate case(s) from negative signals.\n` +
      "// Review each, write the known-good referenceSQL, then paste into tests/eval-cases.ts.\n",
  );
  for (const c of cases) {
    console.log("  {");
    console.log(`    id: ${JSON.stringify(c.id)},`);
    console.log(`    question: ${JSON.stringify(c.question)},`);
    console.log(`    // flagged by signal: ${c.signal}`);
    if (c.sql) console.log(`    // model emitted: ${c.sql.replace(/\s+/g, " ")}`);
    console.log('    referenceSQL: "TODO — write the known-good query",');
    console.log('    compare: "scalar", // or "set" | "ordered"');
    console.log("    tags: [],");
    console.log("  },");
  }
}

main().catch((e) => {
  console.error("build-eval-set failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
