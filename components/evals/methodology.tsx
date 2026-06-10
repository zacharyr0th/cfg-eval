import { Ban, Database, FlaskConical, ShieldCheck, Target } from "lucide-react";

/**
 * The "why these five evals" prose — the substance of the old static /evals
 * page, condensed into a reference column beside the runner. Each entry maps
 * to one way a NL→SQL system can break.
 */

const EVALS: { icon: typeof Target; title: string; plain: string; body: React.ReactNode }[] = [
  {
    icon: Target,
    title: "1 · Execution correctness",
    plain: "Does the query return the right answer?",
    body: (
      <>
        21 prompts across easy / medium / hard tiers — including an{" "}
        <strong className="font-medium text-foreground">adversarial slice</strong>{" "}engineered to tempt
        schema drift. The reference query executes live per trial; the model&apos;s{" "}
        <strong className="font-medium text-foreground">result set</strong> is diffed against that answer — not
        the SQL text. Any semantically equivalent query passes.
      </>
    ),
  },
  {
    icon: Database,
    title: "2 · SQL validity",
    plain: "Does every generated query run without errors?",
    body: (
      <>
        Every constrained output must execute without error. An execution failure is a{" "}
        <strong className="font-medium text-foreground">grammar failure</strong> — the CFG accepted a token
        sequence ClickHouse rejected.
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: "3 · Schema adherence",
    plain: "Does the SQL only use columns and functions that actually exist?",
    body: (
      <>
        Every identifier is validated against the live schema whitelist. Hallucinated columns and functions are{" "}
        <strong className="font-medium text-foreground">structurally impossible</strong> under the grammar.
      </>
    ),
  },
  {
    icon: Ban,
    title: "4 · Refusal",
    plain: "Does the model decline questions the data can't answer?",
    body: (
      <>
        Out-of-scope prompts must be declined via <code>cannot_answer</code>. Half are{" "}
        <strong className="font-medium text-foreground">phantom columns</strong> — real NYC-TLC fields
        (<code>mta_tax</code>, <code>VendorID</code>) absent from this 13-column subset — which look answerable.
        The baseline doesn&apos;t decline: it answers anyway with a degenerate query (<code>SELECT 0</code>,{" "}
        <code>WHERE 1=0</code>) that renders as a confident wrong number.
      </>
    ),
  },
  {
    icon: FlaskConical,
    title: "5 · CFG vs no-CFG head-to-head",
    plain: "Same prompts, with and without the grammar — the two result columns in every row.",
    body: (
      <>
        Not a separate section: every prompt runs twice, and this comparison is the{" "}
        <strong className="font-medium text-foreground">CFG / no CFG columns</strong> in each row and the paired
        scoreboard bars. On clean prompts a strong base model already nails the SQL, so both modes hit 100% —
        the grammar separates on the{" "}
        <strong className="font-medium text-foreground">adversarial and phantom-column slices</strong>: schema
        grounding and refusal, the failure modes CFG forecloses by construction.
      </>
    ),
  },
];

export function MethodologyEvals() {
  return (
    <div className="space-y-3">
      {EVALS.map(({ icon: Icon, title, plain, body }) => (
        <div key={title} className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon aria-hidden className="h-3 w-3" />
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold">{title}</h3>
            {/* The gist first, in plain English; the expert detail below it. */}
            <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{plain}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[10px]">
              {body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MethodologyContext() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card/50 p-3">
        <p className="text-[11px] font-medium text-muted-foreground">How the metric stays honest</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            <strong className="font-medium text-foreground">Difficulty tiers</strong> — pass rates reported per
            tier; an all-100% set can&apos;t catch the regressions that matter.
          </li>
          <li>
            <strong className="font-medium text-foreground">Adversarial cases that bite</strong> — a clean prompt
            saturates both modes and proves nothing. So the set includes prompts that expose the baseline:
            derived <code>duration</code>/<code>speed</code> and avg-of-ratios tempt off-schema functions
            (<code>dateDiff</code>, <code>toUnixTimestamp</code>); phantom columns tempt a confident non-answer
            (<code>SELECT 0</code>). That&apos;s where CFG and the abstain tool measurably separate — reported as
            their own slice.
          </li>
          <li>
            <strong className="font-medium text-foreground">Live reference answers</strong> — the expected result
            is re-fetched from ClickHouse for every trial, so the grader can never drift from the real data.
          </li>
          <li>
            <strong className="font-medium text-foreground">False-positive hardening</strong> — every case ships
            distractor queries (sum-vs-avg, wrong date) proven to yield a <em>different</em> result than the
            reference, so a coincidentally-right query can&apos;t pass.
          </li>
          <li>
            <strong className="font-medium text-foreground">Runbook</strong> — vitest runs append per-tier metrics
            to a local history and log deltas vs the prior run; an observability backend traces the online side
            (in-app runs land there too, tagged <code className="font-mono text-[10px]">source: app</code>).
          </li>
        </ul>
      </div>

      <div className="rounded-lg border bg-card/50 p-3">
        <p className="text-[11px] font-medium text-muted-foreground">The same suite, from the terminal</p>
        <pre
          aria-label="Commands to run the evals locally"
          tabIndex={0}
          className="mt-2 overflow-x-auto rounded bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {`# offline: grammar + schema logic (no key)
bun run test

# full end-to-end suite (GPT-5 + ClickHouse)
RUN_EVALS=1 bun run test

# case health: references + distractors (ClickHouse only)
VERIFY_CASES=1 bun run test`}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          This page runs the same cases through the same grading functions, one trial per click — the vitest
          suite stays the source of truth for CI.
        </p>
      </div>
    </div>
  );
}
