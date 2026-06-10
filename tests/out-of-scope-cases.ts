/**
 * Out-of-scope / unanswerable prompts for eval #4.
 *
 * The dataset has no weather, driver, vehicle, PII, or geo columns. A robust
 * NL→SQL system must NOT fabricate them — and, just as important, must not answer
 * at all. The constrained path carries a `cannot_answer` tool alongside the
 * grammar tool (`tool_choice: "required"`), so on these prompts it should DECLINE
 * rather than be forced into a degenerate query (a bare `count()`) that renders as
 * a confident number. Eval #4 asserts that abstention directly, keeps the grammar's
 * anti-fabrication guarantee as a secondary check, and reports how often the
 * UNCONSTRAINED model hallucinates the missing columns — the failure the abstain
 * path and the grammar together prevent.
 *
 * Two `category`s, because they exercise different failure modes:
 *   - "out-of-domain"  — clearly off-topic (weather, PII, vehicle make). A model
 *     mostly knows to back off here, so these are the easy refusals.
 *   - "phantom-column" — the HARD ones. They read exactly like answerable taxi
 *     questions and name columns that DO exist in the canonical NYC-TLC schema
 *     (VendorID, RatecodeID, mta_tax, improvement_surcharge, store_and_fwd_flag)
 *     but were dropped from this 13-column subset. Observed behaviour (GPT-5):
 *     the unconstrained baseline rarely fabricates the column outright — it's
 *     capable enough to instead emit a degenerate query that satisfies the
 *     "output only SQL" instruction (`SELECT 0 AS mta_tax`, `... WHERE 1=0`,
 *     `SELECT 'UNKNOWN_VENDOR'`), which renders as a confident wrong number. So
 *     the value the constrained path adds here is the ABSTAIN tool (it declines)
 *     more than the grammar (which would also bar an invented column, but the
 *     model seldom tries). The grammar's own anti-drift bite shows up on the
 *     answerable adversarial slice instead (toUnixTimestamp / dateDiff — see
 *     tests/eval-cases.ts), where the model genuinely reaches off-schema.
 */

type OutOfScopeCategory = "out-of-domain" | "phantom-column";

export interface OutOfScopeCase {
  id: string;
  question: string;
  /** Why the schema can't answer it — shown in the assertion message. */
  reason: string;
  category: OutOfScopeCategory;
}

export const OUT_OF_SCOPE_CASES: OutOfScopeCase[] = [
  /* ---- Out-of-domain: clearly not about the trip columns ----------------- */
  {
    id: "weather",
    question: "What was the weather on 2015-08-15?",
    reason: "no weather data in the schema",
    category: "out-of-domain",
  },
  {
    id: "driver-names",
    question: "Show me the names of the drivers with the most trips.",
    reason: "no driver identity columns",
    category: "out-of-domain",
  },
  {
    id: "geo-latlong",
    question: "What is the average pickup latitude and longitude?",
    reason: "lat/long are deliberately excluded from the grammar",
    category: "out-of-domain",
  },
  {
    id: "vehicle-make",
    question: "How many trips were made in a Toyota Prius?",
    reason: "no vehicle / make / model columns",
    category: "out-of-domain",
  },
  {
    id: "passenger-email",
    question: "List the email addresses of passengers who tipped more than $50.",
    reason: "no passenger PII columns",
    category: "out-of-domain",
  },

  /* ---- Phantom columns: real NYC-TLC fields absent from this 13-column      */
  /*      subset. These look answerable and tempt the baseline to fabricate.   */
  {
    id: "mta-tax",
    question: "How much MTA tax was collected across all trips?",
    reason: "no mta_tax column — this subset drops the TLC tax/surcharge fields",
    category: "phantom-column",
  },
  {
    id: "vendor-breakdown",
    question: "Break down the number of trips by taxi vendor.",
    reason: "no vendor / VendorID column in the schema",
    category: "phantom-column",
  },
  {
    id: "rate-code",
    question: "How many trips used the JFK flat rate (rate code 2)?",
    reason: "no RatecodeID column in the schema",
    category: "phantom-column",
  },
  {
    id: "improvement-surcharge",
    question: "What was the total improvement surcharge collected over the period?",
    reason: "no improvement_surcharge column in the schema",
    category: "phantom-column",
  },
  {
    id: "store-and-fwd",
    question: "How many trips were store-and-forward trips?",
    reason: "no store_and_fwd_flag column in the schema",
    category: "phantom-column",
  },
];
