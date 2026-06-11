/**
 * Lark grammar + schema description for safe NL→SQL over `default.nyc_taxi`.
 *
 * The grammar is the load-bearing security boundary: GPT-5's CFG decoder will
 * not emit a token that takes the parse out of the accepted language. So the
 * grammar enforces, by construction:
 *   - SELECT-only (no DDL / DML / TRUNCATE / GRANT / ATTACH / DETACH).
 *   - A single table reference: `default.nyc_taxi` (or `nyc_taxi`). No joins.
 *   - No subqueries, no CTEs, no UNION, no settings clauses, no comments,
 *     no semicolons, no multi-statement input.
 *   - Whitelisted columns (the 13 below) in the projection; lat/long are
 *     deliberately excluded (no geo in v1) — kept out of the projection by the
 *     grammar and out of predicates by the runtime guard (see the note below).
 *   - Whitelisted aggregates: count / sum / avg / min / max / uniq / uniqExact.
 *   - Whitelisted date functions: toDate, toHour, toStartOfDay, toStartOfHour,
 *     toStartOfMonth, toDayOfWeek, toMonth, toYear.
 *   - Predicates: comparisons between two expressions (column-vs-column and
 *     arithmetic both sides), [NOT] IN, [NOT] BETWEEN, IS [NOT] NULL, NOT (...).
 *
 * One deliberate looseness: bare IDENTIFIERs are accepted in predicate /
 * grouping / ordering positions so projection aliases ("... AS trips ...
 * HAVING trips > 100") can be referenced — a context-free grammar can't tell an
 * alias from a stray column name. IDENTIFIER is lowercase-only, so uppercase
 * SQL keywords (AND, OR, SELECT, GROUP, …) are excluded from alias positions.
 * An out-of-whitelist name in a non-projection position still parses the
 * grammar; an unknown column then errors on ClickHouse (evals 2–3 assert real
 * decodes don't do this), and the one case that would NOT error — the lat/long
 * columns, which physically exist — is rejected by the runtime guard
 * (lib/sql-guard.ts) on both the generated and edited paths. The projection
 * itself stays whitelist-only by construction.
 *
 * Notes on Lark constraints from the OpenAI cookbook:
 *   - No lookaround / lazy quantifiers / terminal priorities / %declares.
 *   - Greedy lexing: every terminal is matched atomically; don't try to span
 *     free text across multiple terminals.
 *   - Keep rules simple — the API rejects grammars that are "too complex".
 *   - Thread whitespace EXPLICITLY (a bounded `WS` terminal, required
 *     between keywords/identifiers, optional `WS?` around punctuation and
 *     operators) rather than `%ignore WS`. LLGuidance's constraint engine
 *     handles explicit whitespace more reliably than `%ignore`, which the
 *     cookbook explicitly cautions against.
 *   - Every terminal is bounded by content AND length (e.g. `{1,64}`,
 *     `{0,200}`) so the model can't emit unbounded payloads that drift the
 *     decode out of distribution.
 *
 * Uppercase keywords are required by the grammar. The system prompt instructs
 * the model accordingly; the CFG enforces it.
 */

const NYC_TAXI_DATE_RANGE = {
  min: "2015-07-01",
  max: "2015-09-30",
} as const;

/** Columns the grammar accepts. lat/long are deliberately excluded. */
export const NYC_TAXI_COLUMNS = [
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
] as const;

/**
 * Aggregate + date functions the grammar accepts, as data. These MIRROR the
 * `count` / `OTHER_AGG_FN` and `date_fn_name` productions in NYC_TAXI_LARK below
 * — the grammar string is still the load-bearing constraint at decode time;
 * these arrays exist so non-grammar consumers (the schema-adherence eval, which
 * checks generated SQL only references real columns/functions) share one
 * allowlist instead of re-typing it. Keep in sync with the Lark rules.
 */
export const NYC_TAXI_AGGREGATES = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "uniq",
  "uniqExact",
] as const;

export const NYC_TAXI_DATE_FUNCTIONS = [
  "toDate",
  "toHour",
  "toStartOfDay",
  "toStartOfHour",
  "toStartOfMonth",
  "toDayOfWeek",
  "toMonth",
  "toYear",
] as const;

/** Human-readable schema fragment for the system prompt. */
export const NYC_TAXI_SCHEMA_DESCRIPTION = `
Table: default.nyc_taxi (20,000,000 rows, MergeTree)
Date range: pickup_datetime spans ${NYC_TAXI_DATE_RANGE.min} to ${NYC_TAXI_DATE_RANGE.max} inclusive.

Columns (name : type):
  trip_id            : UInt32
  pickup_datetime    : DateTime
  dropoff_datetime   : DateTime
  passenger_count    : Nullable(UInt8)
  trip_distance      : Nullable(Float32)    -- miles
  fare_amount        : Float32              -- base fare, USD
  extra              : Float32              -- rush-hour & overnight extras (NOT improvement_surcharge, NOT mta_tax)
  tip_amount         : Float32              -- USD
  tolls_amount       : Float32              -- USD
  total_amount       : Float32              -- fare + extra + tip + tolls, USD
  payment_type       : Enum8('CSH','CRE','NOC','DIS','UNK')
                       -- CSH=cash, CRE=credit card, NOC=no charge,
                       -- DIS=dispute, UNK=unknown
  pickup_ntaname     : LowCardinality(String)   -- pickup neighborhood (NTA)
  dropoff_ntaname    : LowCardinality(String)   -- dropoff neighborhood (NTA)

Lat/long columns exist in the table but the grammar does NOT accept them.

Columns dropped from this subset — do NOT substitute another column if asked about these:
  improvement_surcharge, mta_tax, VendorID, RatecodeID, store_and_fwd_flag
Use cannot_answer for any question that specifically asks about one of these fields.

Filtering by payment type uses the enum string codes:
  WHERE payment_type = 'CRE'              -- credit-card trips
  WHERE payment_type IN ('CSH','CRE')

Filtering by date uses literal strings:
  WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'
  WHERE pickup_datetime BETWEEN '2015-07-01 00:00:00' AND '2015-08-31 23:59:59'  -- multi-month range
  WHERE toDate(pickup_datetime) = '2015-08-15'

Projection rule — EVERY column in SELECT must be inside an aggregate OR listed in GROUP BY.
For ratio averages, the division goes INSIDE avg: avg(tip_amount / fare_amount)
NOT avg(tip_amount) / fare_amount — the grammar accepts both, but only the first executes.

Common analytical patterns the grammar accepts:
  SELECT count(), avg(tip_amount) FROM nyc_taxi WHERE ...
  SELECT toDate(pickup_datetime) AS day, sum(total_amount) FROM nyc_taxi GROUP BY day ORDER BY day
  SELECT avg(tip_amount / fare_amount) FROM nyc_taxi WHERE fare_amount > 0 AND payment_type = 'CRE'
  SELECT pickup_ntaname, avg(tip_amount / total_amount) AS tip_pct
    FROM nyc_taxi WHERE total_amount > 0 GROUP BY pickup_ntaname ORDER BY tip_pct DESC LIMIT 10
`.trim();

/** The Lark grammar string sent to GPT-5 in the custom-tool format. */
export const NYC_TAXI_LARK = String.raw`
start: select_stmt

// Whitespace is threaded EXPLICITLY (best practice per OpenAI's GPT-5 CFG
// cookbook). WS = bounded 1+ whitespace chars. Required between keywords
// and identifiers; optional ("WS?") around punctuation, operators, and
// parens — Lark's lexer rejects zero-width terminals, so we express
// "optional whitespace" at the rule level via "WS?", not as a separate
// terminal.
select_stmt: "SELECT" WS projection WS "FROM" WS table_ref (WS where_clause)? (WS group_by)? (WS having_clause)? (WS order_by)? (WS limit)?

projection: proj_item (WS? "," WS? proj_item)*
proj_item: expr (WS "AS" WS IDENTIFIER)?

expr: arith_expr
arith_expr: term (WS? ADD_OP WS? term)*
term: factor (WS? MUL_OP WS? factor)*
factor: aggregate
      | date_fn_call
      | column
      | NUMBER
      | "(" WS? arith_expr WS? ")"

// Each function name is inlined as an anonymous string literal rather than a
// single DATE_FN regex terminal. A "|"-alternation terminal compiles to a regex
// that overlaps IDENTIFIER; keeping these as distinct string literals avoids
// leaning on terminal-priority tie-breaking, which is engine-specific — Lark's
// Earley dynamic lexer (used by check_grammar.py) actually explores BOTH matches
// as an ambiguity, while LLGuidance (the decode-time engine) lexes its own way.
// The accepted language is identical either way; this just keeps it simple.
date_fn_call: date_fn_name "(" WS? column WS? ")"
date_fn_name: "toDate"
            | "toHour"
            | "toStartOfDay"
            | "toStartOfHour"
            | "toStartOfMonth"
            | "toDayOfWeek"
            | "toMonth"
            | "toYear"

// 'count()' and 'count(*)' are both valid in ClickHouse (and common in NL->SQL
// outputs); the other aggregates strictly require a numeric argument. na_expr
// (not arith_expr) is used as the aggregate argument to prevent nesting like
// sum(count()), which ClickHouse rejects at runtime.
aggregate: "count" "(" WS? count_arg? WS? ")"
         | OTHER_AGG_FN "(" WS? na_expr WS? ")"
count_arg: "*" | na_expr

// Non-aggregate expression tree used as the aggregate-argument rule. Mirrors
// arith_expr / term / factor but omits aggregate from na_factor, preventing
// nested aggregates like sum(count()) or avg(sum(x)).
na_expr: na_term (WS? ADD_OP WS? na_term)*
na_term: na_factor (WS? MUL_OP WS? na_factor)*
na_factor: date_fn_call
         | column
         | NUMBER
         | "(" WS? na_expr WS? ")"

table_ref: "default" "." "nyc_taxi"
         | "nyc_taxi"

where_clause: "WHERE" WS bool_expr
bool_expr: or_expr
or_expr: and_expr (WS "OR" WS and_expr)*
and_expr: predicate (WS "AND" WS predicate)*
predicate: "(" WS? bool_expr WS? ")"
         | "NOT" WS predicate
         | comparison
         | in_predicate
         | between_predicate
         | null_predicate

// Both comparison sides take a full operand, so column-vs-column
// ("tip_amount > fare_amount") and arithmetic predicates
// ("tip_amount / fare_amount > 0.2", "HAVING sum(a) / sum(b) > 0.2")
// are expressible — natural answerable questions the old
// scalar-vs-literal shape forced into a refusal. The model is prompted to
// use IS [NOT] NULL for null checks; "= NULL" still parses (NULL matches
// IDENTIFIER) and ClickHouse executes it harmlessly (matches nothing).
comparison: operand WS? CMP_OP WS? operand
operand: arith_expr
       | STRING_LITERAL
       | IDENTIFIER

in_predicate: operand WS ("NOT" WS)? "IN" WS? "(" WS? literal (WS? "," WS? literal)* WS? ")"
between_predicate: operand WS ("NOT" WS)? "BETWEEN" WS literal WS "AND" WS literal
null_predicate: operand WS "IS" (WS "NOT")? WS "NULL"

// Used by GROUP BY / ORDER BY items. IDENTIFIER covers projection aliases
// referenced there (e.g. "count() AS trips ... ORDER BY trips"); it also
// overlaps column names, so a known column has two derivations (the column rule
// vs IDENTIFIER) — a harmless ambiguity, since both accept and the emitted text
// is identical. (HAVING / WHERE predicates take 'operand' instead, which reaches
// aliases via the same IDENTIFIER terminal and aggregates via arith_expr.)
scalar: date_fn_call
      | aggregate
      | column
      | IDENTIFIER

group_by: "GROUP" WS "BY" WS group_item (WS? "," WS? group_item)*
group_item: scalar
          | NUMBER

having_clause: "HAVING" WS bool_expr

order_by: "ORDER" WS "BY" WS order_item (WS? "," WS? order_item)*
// "scalar" already contains "aggregate" (so HAVING can reference aggregates
// directly); listing "aggregate" again here would only add a redundant,
// ambiguous derivation, so order_expr defers to scalar.
order_item: order_expr (WS DIRECTION)?
order_expr: scalar
          | NUMBER

limit: "LIMIT" WS INTEGER

column: "trip_id"
      | "pickup_datetime"
      | "dropoff_datetime"
      | "passenger_count"
      | "trip_distance"
      | "fare_amount"
      | "extra"
      | "tip_amount"
      | "tolls_amount"
      | "total_amount"
      | "payment_type"
      | "pickup_ntaname"
      | "dropoff_ntaname"

literal: STRING_LITERAL
       | NUMBER
       | "NULL"

OTHER_AGG_FN: "sum" | "avg" | "min" | "max" | "uniq" | "uniqExact"
// Note: DATE_FN intentionally removed as a terminal. The function-name set is
// inlined as anonymous string literals in date_fn_name (above) — see the note
// there on why that avoids relying on engine-specific terminal-priority.

CMP_OP: "=" | "!=" | "<>" | "<=" | ">=" | "<" | ">"
ADD_OP: "+" | "-"
MUL_OP: "*" | "/"
DIRECTION: "ASC" | "DESC"

// All terminals bounded by length per the cookbook's best practice
// ("Keep terminals bounded ... {M,N} quantifier"). 64-char identifiers,
// 10-digit LIMIT values, 18-significant-digit numbers, and 200-char string
// literals comfortably cover every realistic query the eval set produces.
// IDENTIFIER is lowercase-only: aliases are always snake_case per the system
// prompt, and lowercase restriction means uppercase SQL keywords (AND, OR,
// SELECT, GROUP, …) cannot match in alias or reference positions.
IDENTIFIER: /[a-z_][a-z0-9_]{0,63}/
INTEGER: /[0-9]{1,10}/
NUMBER: /-?[0-9]{1,12}(\.[0-9]{1,6})?/
STRING_LITERAL: /'([^'\n]|''){0,200}'/

// Explicit whitespace terminal — bounded 1+ chars from [space, tab, newline].
// Optional whitespace in rules is expressed as "WS?" rather than a separate
// zero-width terminal (which Lark's lexer rejects).
WS: /[ \t\n]{1,64}/
`.trim();
