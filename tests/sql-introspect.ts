/**
 * Lightweight SQL introspection for the schema-adherence (#3) eval. NOT a real
 * SQL parser — it's a tokenizer that pulls identifiers out of the narrow
 * ClickHouse SELECT dialect the grammar emits. That's enough to answer one
 * question without a parser dependency:
 *
 *   - Does this SQL only reference columns/tables/functions inside the schema
 *     whitelist? (`schemaViolations`. For constrained output this is empty by
 *     construction; on unconstrained output it catches invented columns like
 *     `trip_date` — and functions outside the whitelist, like `dateDiff`, which
 *     may be real ClickHouse but are off-schema for this app. SQL keywords and
 *     aliases are excluded so the metric counts schema references, not syntax.)
 *
 * The known-good vocabulary (columns, aggregates, date functions) comes from
 * lib/grammar/taxi.ts so this stays in lockstep with what the grammar accepts.
 */

import {
  NYC_TAXI_COLUMNS,
  NYC_TAXI_AGGREGATES,
  NYC_TAXI_DATE_FUNCTIONS,
} from "@/lib/grammar/taxi";

const COLUMNS = new Set<string>(NYC_TAXI_COLUMNS);
const TABLES = new Set<string>(["nyc_taxi", "default"]);
/**
 * Function whitelist, compared case-insensitively: ClickHouse accepts `AVG(`
 * as readily as `avg(`, and a casing difference is not a schema violation.
 * (The grammar itself only emits the canonical casing — this leniency only
 * matters for grading the unconstrained baseline fairly.)
 */
const FUNCTIONS = new Set<string>(
  [...NYC_TAXI_AGGREGATES, ...NYC_TAXI_DATE_FUNCTIONS].map((f) => f.toLowerCase()),
);

/**
 * SQL reserved words — compared case-insensitively. Includes not just the
 * grammar's subset but the wider SQL vocabulary the unconstrained baseline
 * legitimately emits (DISTINCT, CASE…END, LIKE, INTERVAL units, JOIN syntax).
 * These are language keywords, not schema references — counting them as
 * "unknown columns" would falsely inflate the baseline's violation rate.
 * Unknown *identifiers* (invented columns/tables) still flag.
 */
const KEYWORDS = new Set<string>([
  "select", "from", "where", "group", "by", "having", "order", "limit",
  "and", "or", "in", "between", "is", "null", "not", "as", "asc", "desc",
  // Wider SQL surface the baseline may legally use:
  "distinct", "all", "case", "when", "then", "else", "end",
  "like", "ilike", "exists", "offset", "with", "union",
  "join", "inner", "left", "right", "full", "outer", "cross", "on", "using",
  "interval", "year", "quarter", "month", "week", "day", "hour", "minute", "second",
  "true", "false", "settings", "format",
]);

/** Replace every string literal with a space so its contents aren't tokenized.
 *  Handles both ClickHouse escape styles: doubled quotes (`''`) and backslash
 *  (`\'`) — an unconsumed escape would leak the literal's tail into the
 *  identifier scan as false violations. */
const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'/g;
function stripStrings(sql: string): string {
  return sql.replace(STRING_LITERAL, " ");
}

/** Names introduced by `... AS alias` — legal to reference later in GROUP/ORDER/HAVING. */
function aliasNames(sqlNoStrings: string): Set<string> {
  const aliases = new Set<string>();
  const re = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlNoStrings)) !== null) aliases.add(m[1].toLowerCase());
  return aliases;
}

export interface IdentifierUse {
  /** The identifier exactly as written. */
  name: string;
  /** True if immediately followed by `(` — i.e. a function call, not a column. */
  isFunction: boolean;
}

/**
 * Every identifier token in the SQL, each flagged as a function call or not.
 * Identifiers inside string literals are excluded.
 */
export function extractIdentifiers(sql: string): IdentifierUse[] {
  const cleaned = stripStrings(sql);
  const uses: IdentifierUse[] = [];
  // identifier, then optional whitespace + "(" to mark it a function call.
  // The lookbehind stops a numeric literal's exponent from tokenizing as an
  // identifier (`1e6` is a number, not a column named `e6`).
  const re = /(?<![0-9A-Za-z_])([A-Za-z_][A-Za-z0-9_]*)([ \t\n]*\()?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    uses.push({ name: m[1], isFunction: Boolean(m[2]) });
  }
  return uses;
}

export interface SchemaViolation {
  token: string;
  kind: "unknown-column" | "unknown-function";
}

/**
 * Identifiers the SQL references that don't exist in the schema: columns/tables
 * outside the whitelist, or functions outside the accepted set. Empty array ⇒
 * fully grounded. Aliases and keywords are excluded (they're not schema refs).
 */
export function schemaViolations(sql: string): SchemaViolation[] {
  const cleaned = stripStrings(sql);
  const aliases = aliasNames(cleaned);
  const violations: SchemaViolation[] = [];
  for (const use of extractIdentifiers(sql)) {
    const lower = use.name.toLowerCase();
    // Keywords first: "IN (" tokenizes as a function-shaped call but is a
    // predicate keyword, not a schema reference.
    if (KEYWORDS.has(lower)) continue;
    if (use.isFunction) {
      if (!FUNCTIONS.has(lower)) violations.push({ token: use.name, kind: "unknown-function" });
      continue;
    }
    if (TABLES.has(lower) || COLUMNS.has(lower) || aliases.has(lower)) continue;
    violations.push({ token: use.name, kind: "unknown-column" });
  }
  return violations;
}
