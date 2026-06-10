# Natural Language → ClickHouse via GPT-5 Context-Free Grammar

A small Next.js app that turns English questions into ClickHouse SQL using **GPT-5's newly-added Context-Free Grammar (CFG) feature**, then runs the queries against the **NYC Taxi sample dataset** (`default.nyc_taxi`, 20M trips, 2015-07-01 → 2015-09-30) on ClickHouse Cloud.

An exploration of [§3 of OpenAI's GPT-5 cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5_new_params_and_tools#3-contextfree-grammar-cfg): what does grammar-constrained decoding actually buy over an unconstrained baseline, measured with live evals?

- **Live demo:** https://cfg-eval.vercel.app
- **Try it:** https://cfg-eval.vercel.app/query
- **Long-form writeup:** https://cfg-eval.vercel.app/about

```
NL question  ──▶  /api/query  ──▶  GPT-5 + Lark CFG  ──▶  ClickHouse Cloud  ──▶  result table
   (React)         (route)         (custom tool decode)      (HTTPS / 8443)        (React)
```

The model's decode is constrained, at every token, by a Lark grammar that defines a safe SELECT subset over `nyc_taxi`. Anything outside the grammar — DDL, DML, joins, subqueries, comments, lat/long columns, lowercase keywords — is **structurally unrepresentable** in the output, not just discouraged.

---

## Quick start

Requires Node 20+ (or [Bun](https://bun.sh)), an [OpenAI API key with GPT-5 access](https://platform.openai.com/api-keys), and a ClickHouse Cloud service with the **NYC Taxi sample dataset** loaded.

```bash
# 1. Install
bun install            # or: npm install

# 2. Configure env
cp .env.example .env.local
#   Fill in OPENAI_API_KEY + CLICKHOUSE_HOST/USER/PASSWORD/DATABASE.

# 3. Run
bun run dev
```

Open **http://localhost:3000/query**, type a question (e.g. "Top 5 pickup neighborhoods by trip count in August 2015"), watch GPT-5 emit a grammar-constrained SQL query and ClickHouse return the rows.

---

## The deliverables

### 1. Deployed app — `/query`

A single-prompt form. The route at [`app/api/query/route.ts`](app/api/query/route.ts):
1. validates the body with Zod,
2. checks an in-memory LRU cache (identical question → instant zero-token hit),
3. calls [`generateSQLConstrained`](lib/nl-to-sql.ts) — a GPT-5 Responses API request with a custom tool whose `format` is the Lark grammar,
4. extracts the SQL from the `custom_tool_call` output item,
5. executes it via [`runQuery`](lib/clickhouse.ts) against ClickHouse Cloud (HTTPS / 8443, max-execution-time + max-result-rows guards),
6. returns `{ sql, columns, rows, generationMs, executionMs, usage }`.

### 2. The CFG — `lib/grammar/taxi.ts`

A Lark grammar accepting only: one `SELECT` from `nyc_taxi`; 13 whitelisted columns (lat/long excluded); aggregates `count/sum/avg/min/max/uniq/uniqExact`; date functions `toDate/toHour/toStartOf*/toDayOfWeek/toMonth/toYear`; `WHERE/GROUP BY/HAVING/ORDER BY/LIMIT`; `UPPERCASE` keywords. Whitespace is threaded explicitly (per the cookbook) rather than via `%ignore WS`; every terminal is content- and length-bounded.

### 3. Four evals + a head-to-head — `tests/evals.test.ts`

Gated behind `RUN_EVALS=1` because they call GPT-5 and run real queries:

```bash
RUN_EVALS=1 bun run test                       # full set, default N=2 trials per case
RUN_EVALS=1 EVAL_N=5 bun run test              # 5 trials per case
RUN_EVALS=1 EVAL_SLICE=headline bun run test   # discriminating slice only (cheap headline run)
```

The full set splits into a **control arm** (clean prompts — both modes score ~100%, proving the grammar costs nothing) and a **discriminating slice** (3 adversarial + 5 phantom-column prompts built to make the baseline fail). The `HEADLINE` suite prints that slice as one table — baseline drifts off schema / answers unanswerable questions, constrained stays clean / declines — and asserts the constrained side is clean. `EVAL_SLICE=headline` runs just those 8 prompts when you only want the proof.

| # | Eval | What it asserts |
| --- | --- | --- |
| 1 | **Execution correctness** | Result matches a live ClickHouse reference run for each of 21 labelled prompts (easy/medium/hard + an adversarial slice). Compares result sets, not SQL strings. pass@N ≥ 0.5. |
| 2 | **SQL validity** | Every constrained output executes on ClickHouse — zero failures. An execution error means the grammar accepted something CH didn't. |
| 3 | **Schema adherence** | Generated SQL references only real columns/tables/functions. Zero violations on constrained output by construction; the adversarial slice is where the unconstrained baseline drifts (`toUnixTimestamp`, `dateDiff`). |
| 4 | **Refusal handling** | 10 unanswerable prompts (out-of-domain + phantom columns — real NYC-TLC fields absent from this 13-column subset). Constrained path declines via `cannot_answer` tool; unconstrained baseline emits degenerate answers (`SELECT 0 AS mta_tax`, `WHERE 1=0`). |
| 5 | **CFG vs no-CFG head-to-head** | Per-case + overall + adversarial-slice tables, each with a `schemaClean` column. Hard assertion: constrained `execRate == 1.0`. |
| ★ | **HEADLINE** | The discriminating slice in one table: on the 8 prompts built to break the baseline, `baselineFailed` vs `cfgFailed` (asserted 0). Persisted per run in the runbook. |

Cases live in [`tests/eval-cases.ts`](tests/eval-cases.ts) and [`tests/out-of-scope-cases.ts`](tests/out-of-scope-cases.ts). The SQL introspection behind eval 3 ([`tests/sql-introspect.ts`](tests/sql-introspect.ts)) has its own offline unit tests. False-positive hardening (`VERIFY_CASES=1 bun run test`) checks that each case's distractor SQL differs from the reference answer — so a coincidentally-correct query can't pass.

The adversarial slice design and grading methodology are explained in the [long-form writeup](https://cfg-eval.vercel.app/about).

---

## Architecture

```
app/
  page.tsx              landing
  about/page.tsx        long-form writeup (context, grammar, evals, decisions)
  query/page.tsx        single-prompt form + Trace sidebar (client)
  evals/page.tsx        in-browser eval runner (same cases + grading as vitest)
  api/query/route.ts    POST: NL -> grammar-constrained SQL -> ClickHouse
  api/evals/route.ts    POST: run ONE eval trial, graded vs a live reference run
lib/
  openai.ts             OpenAI client + reasoning/verbosity defaults
  clickhouse.ts         CH Cloud client + bounded runQuery
  nl-to-sql.ts          generateSQLConstrained (CFG) + generateSQLUnconstrained (baseline)
  sql-guard.ts          runtime allowlist guard for manually edited SQL (/api/execute)
  result-compare.ts     result-set comparison (set/ordered/scalar) — correctness oracle
  eval-run.ts           shared request/verdict contract for the in-app eval runner
  grammar/
    taxi.ts             the canonical Lark grammar + schema description + allowlists
tests/
  eval-cases.ts         21 labelled cases (question, referenceSQL, compareMode, difficulty, distractors)
  out-of-scope-cases.ts 10 unanswerable prompts for the refusal eval
  sql-introspect.ts     identifier extraction for the schema-adherence guard
  evals.test.ts         the four evals + head-to-head (gated by RUN_EVALS=1)
  runbook.ts            persists per-run metrics + diffs vs the previous run
scripts/
  check_grammar.py      extracts NYC_TAXI_LARK from the .ts module and validates via Earley parser
  smoke-gpt5.ts         one-shot end-to-end smoke (bun run scripts/smoke-gpt5.ts)
  build-eval-set.ts     reads negative signals back and prints EvalCase scaffolds
```

Notable design choices:
- **Raw `openai` SDK** — the custom-tool + grammar shape isn't first-class in `@ai-sdk/openai` yet.
- **Earley parser** (not LALR) for local validation — explicit whitespace creates LALR-1 conflicts; LLGuidance isn't LALR-bound and accepts the same grammar.
- **In-memory LRU cache** — the 2015 dataset is static; identical questions are instant zero-token hits, bounded at 256 entries.
- **`reasoning.effort: "low"` on the constrained path** — the grammar guarantees syntactic validity, so the model doesn't spend reasoning tokens self-checking. Eval-confirmed latency + cost win at no accuracy loss.
- **LLM observability** via Raindrop HTTP ingestion API, emitted from Next's `after()` (zero user-facing latency). Every `/api/query` and `/api/execute` request lands as a trace event; the eval harness logs each trial as `nl_to_sql_eval`. `build-eval-set.ts` reads those signals back to fold real failures into the regression set. No key set → silent no-op. See [`lib/raindrop.ts`](lib/raindrop.ts).

---

## What I'd add before production

- **Prompt-injection adversarial set** — `DROP TABLE`, `;--`, role-spoofing prompts to demonstrate the grammar's structural safety more directly.
- **Multi-table support** — the grammar pins to one table; real analytics needs joins/CTEs (the cookbook flags "too complex" as a real LLGuidance failure mode).
- **Historical traces in-app** — the Trace sidebar shows the current request; past traces live only in the external dashboard.
- **Auth + durable rate limiting** — the in-process limiter ([`lib/rate-limit.ts`](lib/rate-limit.ts)) resets on restart; production needs auth and a shared store.
- **Persistent eval results + regression alerts** — a CI cron storing metrics per model tier would catch silent regressions.

---

## Tech stack

Next.js 16 (Turbopack) · React 19 · TypeScript · Tailwind + shadcn/ui · `openai` 6.x (Responses API) · `@clickhouse/client` · Vitest · Zod · Python `lark` (Earley) for the local grammar validator.

## Scripts

```bash
bun run dev         # start the dev server
bun run build       # production build (Turbopack)
bun run typecheck   # tsc --noEmit
bun run lint        # eslint
bun run test        # vitest — offline suites always (grammar, sql-guard,
                    # introspection, result-shape); live evals if RUN_EVALS=1
```

```bash
# One-time, for local grammar tests / scripts/check_grammar.py:
python3 -m venv .venv && .venv/bin/pip install lark
```
