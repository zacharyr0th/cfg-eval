import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroBackdrop } from "@/components/hero-backdrop";
import { AboutToc } from "@/components/about-toc";

const REPO_URL = "https://github.com/zacharyr0th/cfg-eval";
const COOKBOOK_URL =
  "https://cookbook.openai.com/examples/gpt-5/gpt-5_new_params_and_tools#3-contextfree-grammar-cfg";
const SPIDER_URL = "https://yale-lily.github.io/spider";
const BIRD_URL = "https://bird-bench.github.io";

export const metadata = { title: "About · CFG Eval" };

const TOC = [
  { id: "the-question", label: "Context" },
  { id: "pipeline", label: "Architecture" },
  { id: "grammar", label: "The CFG" },
  { id: "evals", label: "Evals" },
  { id: "decisions", label: "Design" },
  { id: "results", label: "Results" },
  { id: "future", label: "Honest gaps" },
] as const;

const GRAMMAR_COLUMNS = [
  "trip_id",
  "pickup_datetime",
  "dropoff_datetime",
  "passenger_count",
  "trip_distance",
  "fare_amount",
  "extra",
  "tip_amount",
  "tolls_amount",
  "total_amount",
  "payment_type",
  "pickup_ntaname",
  "dropoff_ntaname",
];

export default function AboutPage() {
  return (
    <section className="relative isolate flex flex-1 flex-col">
      <HeroBackdrop />

      {/* Width track matches the header (max-w-7xl, px-4 md:px-6); on lg+ the
          content takes 3/4 and a sticky ToC takes the right 1/4. */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-10 md:px-6">
        <div className="lg:grid lg:grid-cols-4 lg:gap-12 xl:gap-16">
          <div className="min-w-0 lg:col-span-3">
            {/* Header */}
            <div className="mb-8">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Design · Decisions · Results
              </p>
              <h1 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
                How this works
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                CFG Eval is{" "}
                <strong className="font-medium text-foreground">constrained generation</strong>,
                evaluated — SQL decoded under a context-free grammar (CFG), measured against an
                unconstrained baseline. This page covers the architecture,
                grammar, eval methodology, and key decisions — so the numbers on the{" "}
                <Link
                  href="/evals"
                  className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  evals page
                </Link>{" "}
                mean something. Every file path links to its source on{" "}
                <a href={REPO_URL} target="_blank" rel="noreferrer" className={externalLinkCls}>
                  GitHub
                  <ExternalLink aria-hidden className="inline h-3 w-3" />
                </a>
                .
              </p>
            </div>

            {/* TL;DR */}
            <div className="mb-8 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3.5 text-sm leading-relaxed text-muted-foreground shadow-[var(--shadow-sm)]">
              <span className="font-semibold text-foreground">TL;DR</span> — GPT-5 decodes against
              a context-free grammar, so the SQL it emits is{" "}
              <em className="italic">provably</em> valid SELECT-only ClickHouse. Not just prompted
              to be — structurally enforced at every token. The evals measure what that guarantee
              buys over an unconstrained baseline: a live 20-million-row dataset with a
              deterministic result-set grader instead of an LLM judge.
            </div>

            {/* On this page — inline pills on small screens; lg+ gets the sidebar ToC */}
            <nav aria-label="On this page" className="mb-12 flex flex-wrap gap-1.5 lg:hidden">
              {TOC.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className="rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  {t.label}
                </a>
              ))}
            </nav>

            <div className="space-y-14">
              {/* 1 — The question */}
              <Section id="the-question" eyebrow="Context" title="The question">
                <p>
                  GPT-5&apos;s Responses API added a{" "}
                  <a
                    href={COOKBOOK_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={externalLinkCls}
                  >
                    Context-Free Grammar (CFG) feature
                    <ExternalLink aria-hidden className="inline h-3 w-3" />
                  </a>{" "}
                  — a custom tool whose <code className={codeCls}>format</code> field is a Lark
                  grammar (Lark is the language the grammar is written in). At every decoding
                  step, LLGuidance (the constrained-decoding engine OpenAI runs server-side) masks
                  the logit distribution — in plain terms, it zeroes out the probability of every
                  next token that would break the grammar — so the model can only emit tokens that
                  keep the partial output inside the accepted language. The output is{" "}
                  <em>provably</em> grammar-conformant, not just prompted to be.
                </p>
                <Callout>
                  <strong>Why &ldquo;context-free&rdquo;?</strong> Decades-old CS theory, not an
                  OpenAI coinage. A context-free grammar rule applies regardless of what surrounds
                  it — a <em>condition</em> is a column, operator, and value whether it appears in
                  a WHERE or HAVING clause. That property makes CFGs checkable one token at a time:
                  the engine only needs to track which rules are still open.
                </Callout>
                <p>
                  Does that structural guarantee matter for real analytical queries against a real
                  database? The dataset is ClickHouse&apos;s public NYC Taxi sample — 20 million
                  trips, July–September 2015. Every query runs against it live.
                </p>
              </Section>

              {/* 2 — Pipeline */}
              <Section id="pipeline" eyebrow="Architecture" title="The pipeline">
                <p>
                  In plain terms: your question goes to the server, which checks a cache (repeat
                  questions are answered instantly), asks GPT-5 to write SQL it can only phrase
                  within the grammar, runs that SQL on the database with time and size limits, and
                  returns the rows. The technical version of that flow, for engineers:
                </p>
                <p>
                  The route (<Src path="app/api/query/route.ts" />) is thin on purpose — it&apos;s
                  not the interesting part:
                </p>
                <CodeBlock>
                  {`NL question
  → POST /api/query
  → Zod body validation + in-memory LRU cache check
  → generateSQLConstrained  (`}
                  <SrcPlain path="lib/nl-to-sql.ts" />
                  {`)
      • GPT-5 Responses API
      • custom tool: format = { type: "grammar", syntax: "lark", definition: NYC_TAXI_LARK }
      • function tool: cannot_answer  (for out-of-scope prompts)
      • tool_choice: "required"  →  model MUST call exactly one
  → extract SQL from custom_tool_call output item
  → runQuery  (`}
                  <SrcPlain path="lib/clickhouse.ts" />
                  {`)
      • HTTPS / port 8443 to ClickHouse Cloud
      • server-side guards: max_execution_time 30s, max_result_rows 100 000
  → { sql, columns, rows, generationMs, executionMs, usage }`}
                </CodeBlock>
                <p>
                  Two modes exist:{" "}
                  <Src path="lib/nl-to-sql.ts" label="generateSQLConstrained" /> and{" "}
                  <Src path="lib/nl-to-sql.ts" label="generateSQLUnconstrained" />. The
                  unconstrained path drops the grammar tool and{" "}
                  <code className={codeCls}>cannot_answer</code> — the model emits plain-text SQL
                  with any <code className={codeCls}>```sql</code> fences stripped. Both share the
                  same base system prompt, so the grammar is the only manipulated variable.
                </p>
              </Section>

              {/* 3 — Grammar */}
              <Section id="grammar" eyebrow="The CFG" title="What the grammar enforces">
                <p>
                  The grammar lives in <Src path="lib/grammar/taxi.ts" /> as a Lark string. It is
                  the load-bearing security boundary, not the system prompt. What it enforces, by
                  construction — not by instruction:
                </p>

                <div className="mt-4 overflow-x-auto rounded-xl border bg-card/60 shadow-[var(--shadow-sm)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className={thCls}>Surface</th>
                        <th className={thCls}>What the grammar accepts</th>
                      </tr>
                    </thead>
                    <tbody className="[&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[10.5px]">
                      <tr className="border-b">
                        <td className={tdLabelCls}>Statements</td>
                        <td className={tdBodyCls}>
                          <code>SELECT</code> only. DDL, DML, TRUNCATE, GRANT, ATTACH, and DETACH
                          are not representable — not &ldquo;discouraged,&rdquo; structurally
                          unrepresentable.
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className={tdLabelCls}>Tables</td>
                        <td className={tdBodyCls}>
                          <code>FROM nyc_taxi</code> or <code>FROM default.nyc_taxi</code>. No
                          joins, subqueries, CTEs, or UNION.
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className={tdLabelCls}>Columns</td>
                        <td className={tdBodyCls}>
                          13 whitelisted:{" "}
                          {GRAMMAR_COLUMNS.map((c, i) => (
                            <span key={c}>
                              <code>{c}</code>
                              {i < GRAMMAR_COLUMNS.length - 1 ? ", " : ". "}
                            </span>
                          ))}
                          Lat/long exist in the table but are deliberately excluded — a hallucinated
                          column name simply cannot be emitted.
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className={tdLabelCls}>Functions</td>
                        <td className={tdBodyCls}>
                          7 aggregates (<code>count</code>, <code>sum</code>, <code>avg</code>,{" "}
                          <code>min</code>, <code>max</code>, <code>uniq</code>,{" "}
                          <code>uniqExact</code>) and 8 date functions (<code>toDate</code>,{" "}
                          <code>toHour</code>, <code>toStartOfDay</code>,{" "}
                          <code>toStartOfHour</code>, <code>toStartOfMonth</code>,{" "}
                          <code>toDayOfWeek</code>, <code>toMonth</code>, <code>toYear</code>).
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className={tdLabelCls}>Keywords</td>
                        <td className={tdBodyCls}>
                          UPPERCASE required — the grammar&apos;s anonymous string terminals are
                          uppercase, so lowercase equivalents are outside the accepted language.
                        </td>
                      </tr>
                      <tr>
                        <td className={tdLabelCls}>Statement shape</td>
                        <td className={tdBodyCls}>
                          No semicolons, no comments, no multi-statement input.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <Callout>
                  <strong>One deliberate looseness:</strong> bare IDENTIFIERs in GROUP BY / ORDER
                  BY / HAVING let projection aliases be referenced (e.g.{" "}
                  <code className={codeCls}>count() AS trips … ORDER BY trips</code>). An
                  off-whitelist alias parses but fails on ClickHouse — the projection itself stays
                  whitelist-only, and evals 2–3 confirm this never fires in practice.
                </Callout>

                <h3 className={h3Cls}>Explicit whitespace threading</h3>
                <p>
                  In plain terms: the grammar spells out exactly where spaces are allowed instead
                  of ignoring them everywhere — that keeps the constrained decoder predictable.
                  The{" "}
                  <a
                    href={COOKBOOK_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={externalLinkCls}
                  >
                    GPT-5 CFG cookbook
                    <ExternalLink aria-hidden className="inline h-3 w-3" />
                  </a>{" "}
                  cautions against <code className={codeCls}>%ignore WS</code>. Every
                  keyword/identifier boundary uses an explicit{" "}
                  <code className={codeCls}>WS</code> terminal; optional whitespace uses{" "}
                  <code className={codeCls}>WS?</code> at the rule level rather than a zero-width
                  terminal, which Lark&apos;s lexer rejects.
                </p>

                <h3 className={h3Cls}>Length-bounded terminals</h3>
                <p>
                  Every terminal is bounded by content and length — e.g.{" "}
                  <code className={codeCls}>IDENTIFIER: /[A-Za-z_][A-Za-z0-9_]{"{0,63}"}/</code>,{" "}
                  <code className={codeCls}>
                    STRING_LITERAL: /&apos;([^&apos;\n]|&apos;&apos;){"{0,200}"}&apos;/
                  </code>
                  , <code className={codeCls}>WS: /[ \t\n]{"{1,64}"}/</code>. Unbounded payloads
                  would drift the decode out of distribution.
                </p>

                <h3 className={h3Cls}>The abstain tool</h3>
                <p>
                  The grammar can accept but cannot refuse — an out-of-scope question would force
                  the decoder into a degenerate query. The constrained path adds{" "}
                  <code className={codeCls}>cannot_answer</code> alongside the grammar tool. With{" "}
                  <code className={codeCls}>tool_choice: &quot;required&quot;</code>, the model
                  calls exactly one.
                </p>

                <h3 className={h3Cls}>Earley, not LALR, for the local validator</h3>
                <p>
                  In plain terms: there are two common algorithms for checking text against a
                  grammar, and the faster one (LALR) wrongly rejects some queries this grammar
                  should accept — so the local validator uses the more thorough one (Earley) to
                  match what OpenAI&apos;s engine actually allows. The parser-theory detail, for
                  those who want it:
                </p>
                <p>
                  The Python grammar validator (<Src path="scripts/check_grammar.py" />) uses
                  Lark&apos;s Earley parser, not LALR. Explicit whitespace threading creates LALR-1
                  shift/reduce conflicts wherever an optional{" "}
                  <code className={codeCls}>(WS X)?</code> precedes another{" "}
                  <code className={codeCls}>WS Y</code>; LALR silently resolves these by rejecting
                  valid queries, while Earley explores both paths.{" "}
                  <strong>LLGuidance is not LALR-bound</strong>, so the local validator must match
                  its acceptance behavior, not LALR&apos;s.
                </p>
              </Section>

              {/* 4 — Evals */}
              <Section id="evals" eyebrow="Evals" title="Five axes, one question">
                <p>
                  NL→SQL systems can fail in at least five distinct ways. Each eval suite — all in{" "}
                  <Src path="tests/evals.test.ts" />, cases in{" "}
                  <Src path="tests/eval-cases.ts" /> — isolates one, and a final{" "}
                  <strong className="font-medium text-foreground">HEADLINE</strong> suite condenses
                  the prompts built to break the baseline into a single table:
                </p>

                <div className="mt-4 overflow-x-auto rounded-xl border bg-card/60 shadow-[var(--shadow-sm)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className={thCls}>Axis</th>
                        <th className={thCls}>What it checks</th>
                        <th className={thCls}>Hard contract</th>
                        <th className={thCls}>Baseline comparison</th>
                      </tr>
                    </thead>
                    <tbody className="[&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[10px]">
                      <tr className="border-b align-top">
                        <td className={tdLabelCls}>1 · Execution correctness</td>
                        <td className={tdBodyCls}>
                          Result set vs a{" "}
                          <strong>
                            live ClickHouse run of the reference SQL, fetched fresh every trial
                          </strong>{" "}
                          — never a stored snapshot, never SQL-text comparison. Any semantically
                          equivalent query gets credit.
                        </td>
                        <td className={tdBodyCls}>
                          pass@N — the share of cases solved in at least one of N attempts —
                          reported per difficulty tier (4 easy / 6 medium / 11 hard)
                        </td>
                        <td className={tdBodyCls}>
                          Both modes scored on the same 21 labelled prompts (incl. adversarial slice)
                        </td>
                      </tr>
                      <tr className="border-b align-top">
                        <td className={tdLabelCls}>2 · SQL validity</td>
                        <td className={tdBodyCls}>
                          Every constrained output executes on ClickHouse without error. A failure
                          means the grammar accepted something ClickHouse rejected — a grammar bug,
                          not a model failure.
                        </td>
                        <td className={tdBodyCls}>
                          <code>constrained execRate == 1.0</code>, zero tolerance
                        </td>
                        <td className={tdBodyCls}>
                          Local Lark parse rate logged as a LLGuidance↔Lark divergence diagnostic
                        </td>
                      </tr>
                      <tr className="border-b align-top">
                        <td className={tdLabelCls}>3 · Schema adherence</td>
                        <td className={tdBodyCls}>
                          Every identifier — columns, tables, functions — is extracted by a small
                          SQL introspector (<Src path="tests/sql-introspect.ts" />) and checked
                          against the schema whitelist.
                        </td>
                        <td className={tdBodyCls}>
                          Zero off-schema identifiers in constrained output
                        </td>
                        <td className={tdBodyCls}>
                          The baseline&apos;s off-schema rate (invented columns, non-existent
                          functions) is the headline CFG payoff
                        </td>
                      </tr>
                      <tr className="border-b align-top">
                        <td className={tdLabelCls}>4 · Refusal handling</td>
                        <td className={tdBodyCls}>
                          10 unanswerable prompts — out-of-domain (weather, PII, lat/long) plus{" "}
                          <strong className="font-medium text-foreground">phantom columns</strong>{" "}
                          (<code>mta_tax</code>, <code>VendorID</code> — real NYC-TLC fields absent
                          here; in <Src path="tests/out-of-scope-cases.ts" />) — must be declined via{" "}
                          <code>cannot_answer</code>.
                        </td>
                        <td className={tdBodyCls}>Constrained path always declines</td>
                        <td className={tdBodyCls}>
                          Baseline answers anyway — a degenerate <code>SELECT 0</code> / placeholder,
                          not a refusal; decline rate logged per category
                        </td>
                      </tr>
                      <tr className="border-b align-top">
                        <td className={tdLabelCls}>5 · CFG vs no-CFG</td>
                        <td className={tdBodyCls}>
                          Every labelled prompt runs in both modes; execution, correctness, schema
                          adherence, and refusal rates compared per-case and in aggregate.
                        </td>
                        <td className={tdBodyCls}>
                          The structural contract holds on every output — not that CFG is
                          &ldquo;smarter&rdquo;
                        </td>
                        <td className={tdBodyCls}>This axis is the comparison</td>
                      </tr>
                      <tr className="align-top">
                        <td className={tdLabelCls}>★ · Headline</td>
                        <td className={tdBodyCls}>
                          The discriminating slice in one table: the 8 prompts <em>built</em> to
                          break the baseline — 3 adversarial (tempt schema drift) + 5 phantom-column
                          (tempt fabrication). Clean prompts saturate both modes; this slice is the
                          proof. Run it alone with <code>EVAL_SLICE=headline</code>; the per-run
                          verdict persists to the runbook.
                        </td>
                        <td className={tdBodyCls}>
                          <code>cfgFailed == 0</code> — asserted; the baseline&apos;s failure count
                          is the measurement, not an assertion
                        </td>
                        <td className={tdBodyCls}>
                          Observed: baseline failed 7/8, constrained 0/8
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className={h3Cls}>Keeping the metric honest</h3>
                <p>
                  Three things informed by{" "}
                  <a href={SPIDER_URL} target="_blank" rel="noreferrer" className={externalLinkCls}>
                    Spider
                    <ExternalLink aria-hidden className="inline h-3 w-3" />
                  </a>
                  ,{" "}
                  <a href={BIRD_URL} target="_blank" rel="noreferrer" className={externalLinkCls}>
                    BIRD
                    <ExternalLink aria-hidden className="inline h-3 w-3" />
                  </a>
                  {" "}(the two standard academic text-to-SQL benchmarks), and OpenAI&apos;s
                  Text-to-SQL eval cookbook:
                </p>
                <DefList>
                  <DefItem term="Difficulty tiers">
                    Cases are tagged easy / medium / hard; pass@N is reported per tier. A flat
                    aggregate can hide regressions that only surface on the hard cases.
                  </DefItem>
                  <DefItem term="Live reference answers">
                    The expected result is re-fetched from ClickHouse for every trial — even for the
                    in-app runner. The grader can never drift from what the database actually
                    returns.
                  </DefItem>
                  <DefItem term="False-positive hardening">
                    Every case ships distractor queries — plausible-but-wrong SQL (sum-vs-avg, wrong
                    date, reversed sort).{" "}
                    <code className={codeCls}>VERIFY_CASES=1 bun run test</code> asserts each
                    distractor&apos;s result <em>differs</em> from the reference answer. A
                    coincidentally-right query can&apos;t pass.
                  </DefItem>
                </DefList>

                <Callout>
                  <strong>No LLM-as-judge.</strong> The standard cookbook leans on one because its
                  tables are empty — no ground truth. A populated 20M-row dataset with deterministic
                  result-set comparison is a stronger signal. A judge would only add noise.
                </Callout>
              </Section>

              {/* 5 — Design decisions */}
              <Section id="decisions" eyebrow="Design" title="Key decisions">
                <div className="divide-y divide-border/30">
                  <Decision title="Raw openai SDK, not the Vercel AI SDK">
                    The custom-tool + grammar shape isn&apos;t yet first-class in{" "}
                    <code className={codeCls}>@ai-sdk/openai</code>. Direct{" "}
                    <code className={codeCls}>
                      {`client.responses.create({ tools: [{ type: "custom", format: { type: "grammar", ... } }] })`}
                    </code>{" "}
                    (<Src path="lib/nl-to-sql.ts" />) is cleaner than working around an SDK layer.
                  </Decision>

                  <Decision title='reasoning.effort: "low" for the constrained path'>
                    The CFG guarantees syntactic validity, so the model doesn&apos;t need reasoning
                    tokens to validate its own output. The eval data confirms a strict latency +
                    cost win with no accuracy loss — quantified in the{" "}
                    <a
                      href="#results"
                      className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                    >
                      sample run below
                    </a>
                    . The unconstrained baseline can&apos;t safely use the same setting.
                  </Decision>

                  <Decision title="In-memory LRU cache on /api/query">
                    The dataset is a static 2015 sample — identical question, identical answer.
                    Repeat questions and the built-in demo prompts return instantly with zero token
                    spend. Bounded at 256 entries, per-process; resets on restart.
                  </Decision>

                  <Decision title="Server-side ClickHouse guards">
                    <code className={codeCls}>max_execution_time: 30</code>,{" "}
                    <code className={codeCls}>max_result_rows: 100 000</code>,{" "}
                    <code className={codeCls}>result_overflow_mode: &ldquo;throw&rdquo;</code> (
                    <Src path="lib/clickhouse.ts" />). The grammar prevents most pathological
                    queries, but a heavy aggregate over all 20M rows is still expressible — these
                    caps keep the route under its 60s serverless timeout regardless.
                  </Decision>

                  <Decision title="Observability via raw HTTP, not the vendor SDK">
                    Every request is traced to an LLM observability backend. The vendor&apos;s SDK
                    queues events in a batch buffer that must be flushed before a serverless
                    function suspends — easy to drop on a Vercel freeze. A direct{" "}
                    <code className={codeCls}>await fetch</code> to the ingestion endpoint (
                    <Src path="lib/raindrop.ts" />), called from Next&apos;s{" "}
                    <code className={codeCls}>after()</code>, completes within the request
                    lifecycle with no user-facing latency.
                  </Decision>

                  <Decision title="Prompt cache keys">
                    Both paths stamp a <code className={codeCls}>prompt_cache_key</code> on every
                    Responses API call. The system-prompt + tools prefix is byte-identical across
                    runs for a given mode, so all requests hit the same cached-prefix slot and get
                    an input-token discount and lower TTFT. The constrained key is versioned (
                    <code className={codeCls}>nl-to-sql:constrained:v2</code>) — bumped when the
                    abstain tool changed the prefix.
                  </Decision>
                </div>
              </Section>

              {/* 6 — Results */}
              <Section id="results" eyebrow="Results" title="Sample run">
                <p>
                  The headline: the grammar-constrained mode produced SQL that{" "}
                  <strong className="text-foreground">parsed cleanly 100% of the time</strong>{" "}
                  (vs 87.5% unconstrained), stayed on-schema everywhere, and was{" "}
                  <strong className="text-foreground">~18% faster end-to-end</strong>. The numbers
                  below are an N=2 run — each prompt run twice — of the{" "}
                  <strong className="text-foreground">clean labelled tiers</strong> against{" "}
                  <code className={codeCls}>gpt-5</code>:
                </p>

                <div className="mt-4 overflow-x-auto rounded-xl border bg-card/60 shadow-[var(--shadow-sm)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">
                          Mode
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">
                          parseRate
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">
                          execRate
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">
                          correctRate
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">
                          avg gen
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b bg-primary/5">
                        <td className="px-4 py-3 font-medium">constrained (CFG)</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          1.000
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          1.000
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          1.000
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">2.7 s</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 text-muted-foreground">unconstrained</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                          0.875
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">1.000</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">1.000</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">3.3 s</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <DefList className="mt-4">
                  <DefItem term="CFG hit 100% on local Lark parse">
                    vs 87.5% for the unconstrained baseline. Those failures are still valid
                    ClickHouse — they use lowercase keywords the grammar excludes. CFG forecloses
                    that class by construction.
                  </DefItem>
                  <DefItem term="~18% faster end-to-end">
                    Grammar guarantees syntax, so{" "}
                    <code className={codeCls}>reasoning.effort: &ldquo;low&rdquo;</code> is safe
                    for the constrained path. See the{" "}
                    <a
                      href="#decisions"
                      className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                    >
                      reasoning-effort decision
                    </a>{" "}
                    above. The same setting unconstrained would tank correctness.
                  </DefItem>
                  <DefItem term="The caveat: both modes hit 100% correctness">
                    on this set. Well-formed analytical questions a strong model gets right with or
                    without a grammar — these prompts don&apos;t discriminate, which is why the set
                    was extended. The modes separate on the{" "}
                    <strong className="text-foreground">headline slice</strong> — the 8 prompts
                    built to break the baseline. Observed:{" "}
                    <strong className="text-foreground">
                      the baseline failed 7/8, the constrained path 0/8
                    </strong>
                    . On the adversarial prompts (duration/speed derived from timestamps) the
                    baseline reached for <code className={codeCls}>dateDiff</code> /{" "}
                    <code className={codeCls}>toUnixTimestamp</code>; on the phantom columns it
                    returned confident wrong answers (<code className={codeCls}>SELECT 0 AS
                    mta_tax_collected</code>, a made-up rate-code range over{" "}
                    <code className={codeCls}>extra</code>) while the constrained path declined
                    every one.
                  </DefItem>
                </DefList>
              </Section>

              {/* 7 — What's missing */}
              <Section id="future" eyebrow="Honest gaps" title="What&apos;s still missing">
                <DefList>
                  <DefItem term="A prompt-injection adversarial set">
                    The set covers grounding and abstention. The remaining frontier is{" "}
                    <em>security</em>: a table-driven set of{" "}
                    <code className={codeCls}>DROP TABLE</code>,{" "}
                    <code className={codeCls}>;--</code>, system-impersonation, and role-spoofing
                    prompts would demonstrate what the grammar forecloses that prompting
                    can&apos;t.
                  </DefItem>
                  <DefItem term="Multi-table support">
                    The grammar pins to one table. Joins and CTEs require a much larger grammar —
                    and the cookbook flags &ldquo;too complex&rdquo; as a genuine LLGuidance
                    failure mode.
                  </DefItem>
                  <DefItem term="Automated regression tracking">
                    Each full CLI run snapshots its metrics — including the headline slice verdict
                    — to a local runbook (<Src path="tests/runbook.ts" />) and logs deltas vs the
                    previous run, but it still has to be run by hand and the in-app runner&apos;s
                    results live in page state. A CI cron running the suite per model tier would
                    catch silent regressions automatically.
                  </DefItem>
                  <DefItem term="Auth + durable rate limiting">
                    <Src path="app/api/query/route.ts" label="/api/query" /> has an in-process
                    limiter (20 req/min per caller), but it resets on restart — a best-effort abuse
                    brake. Production needs auth and a shared store (Redis/Upstash).
                  </DefItem>
                </DefList>
              </Section>
            </div>

            {/* Footer CTA */}
            <div className="mt-16 flex flex-col items-start gap-3 border-t border-border/50 pt-10 sm:flex-row sm:items-center">
              <Button
                asChild
                size="lg"
                className="w-full bg-foreground text-background shadow-[var(--shadow-md)] hover:bg-foreground/90 sm:w-auto"
              >
                <Link href="/query">
                  Try a query
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="w-full text-foreground sm:w-auto"
              >
                <Link href="/evals">
                  Run the evals
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Right rail — sticky ToC, desktop only */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-8">
              <AboutToc items={TOC} />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

// ── Shared style constants ────────────────────────────────────────────────────

const codeCls =
  "rounded bg-muted/70 px-1 py-px font-mono text-[0.82em] text-foreground";

const externalLinkCls =
  "inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground";

const h3Cls = "mt-6 text-sm font-semibold text-foreground";

const thCls = "px-4 py-3 text-left text-xs font-semibold text-muted-foreground";
const tdLabelCls =
  "sm:whitespace-nowrap px-4 py-3 align-top text-xs font-semibold text-foreground";
const tdBodyCls = "px-4 py-3 align-top text-xs leading-relaxed text-muted-foreground";

// ── Source links ──────────────────────────────────────────────────────────────

function Src({ path, label }: { path: string; label?: string }) {
  return (
    <a
      href={`${REPO_URL}/blob/main/${path}`}
      target="_blank"
      rel="noreferrer"
      className="rounded bg-muted/70 px-1 py-px font-mono text-[0.82em] text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {label ?? path}
    </a>
  );
}

function SrcPlain({ path }: { path: string }) {
  return (
    <a
      href={`${REPO_URL}/blob/main/${path}`}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
    >
      {path}
    </a>
  );
}

// ── Layout components ─────────────────────────────────────────────────────────

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mb-5 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_em]:italic">
        {children}
      </div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-xl border bg-card/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground shadow-[var(--shadow-sm)] [&_strong]:font-semibold [&_strong]:text-foreground">
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-xl border bg-muted/40 px-4 py-3.5 font-mono text-[11px] leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function DefList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={`divide-y divide-border/30 text-sm text-muted-foreground${className ? ` ${className}` : ""}`}
    >
      {children}
    </ul>
  );
}

function DefItem({ term, children }: { term: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-1 gap-y-1 py-3.5 first:pt-1.5 last:pb-0 md:grid-cols-[190px_1fr] md:items-start md:gap-x-6 md:gap-y-0">
      <div className="font-semibold leading-snug text-foreground md:pt-px">{term}</div>
      <div className="leading-relaxed [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_a]:transition-colors [&_a:hover]:decoration-foreground [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.82em] [&_em]:italic [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </li>
  );
}

function Decision({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-y-1.5 py-4 first:pt-0 last:pb-0 md:grid-cols-[190px_1fr] md:items-start md:gap-x-8 md:gap-y-0">
      <p className="text-sm font-semibold leading-snug text-foreground md:pt-px">{title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.82em] [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </p>
    </div>
  );
}
