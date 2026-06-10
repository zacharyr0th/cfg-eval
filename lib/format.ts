/**
 * Display + type-inference helpers for query-result cells.
 *
 * ClickHouse's JSON output quotes 64-bit integers as strings to preserve
 * precision (`output_format_json_quote_64bit_integers`), so `count()` / `sum()`
 * over large tables arrive here as numeric *strings*, not JS numbers. Every
 * helper below treats a numeric-looking string as a number, so alignment,
 * grouping, sorting, and charting all behave the same whether ClickHouse sent
 * `42` or `"42"`.
 */

// Integers, decimals, and scientific notation. Anchored + trimmed by the caller.
const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

// `YYYY-MM-DD`, optionally with a `HH:MM[:SS]` time (space- or T-separated).
const TEMPORAL_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

export function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t !== "" && NUMERIC_RE.test(t);
  }
  return false;
}

/** Coerce a cell to a finite number, or null if it isn't numeric. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && isNumericValue(v)) return Number(v);
  return null;
}

function isTemporalValue(v: unknown): boolean {
  return typeof v === "string" && TEMPORAL_RE.test(v.trim());
}

/**
 * Parse a ClickHouse date/datetime string into a Date, interpreting it as UTC
 * so chart axes don't drift by the viewer's timezone. Returns null if unparseable.
 */
export function parseTemporal(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!TEMPORAL_RE.test(t)) return null;
  const [datePart, timePart] = t.split(/[ T]/);
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = (timePart ?? "").split(":").map(Number);
  const ms = Date.UTC(y, mo - 1, d, hh, mm, ss);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function columnValues(rows: ReadonlyArray<ReadonlyArray<unknown>>, col: number): unknown[] {
  return rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
}

/** A column is numeric iff it has at least one value and all non-null values are numeric. */
export function isNumericColumn(rows: ReadonlyArray<ReadonlyArray<unknown>>, col: number): boolean {
  const vals = columnValues(rows, col);
  return vals.length > 0 && vals.every(isNumericValue);
}

/** A column is temporal iff it has at least one value and all non-null values parse as dates. */
export function isTemporalColumn(rows: ReadonlyArray<ReadonlyArray<unknown>>, col: number): boolean {
  const vals = columnValues(rows, col);
  return vals.length > 0 && vals.every(isTemporalValue);
}

/** Group digits and cap fractional precision so `167617057.06` reads cleanly. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** SI-compact form (`167.6M`, `1.2K`) for headline stats where width is tight. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

/** Render a duration in ms as `1.8 s` past a second, else `408 ms`. */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/**
 * Render a ClickHouse date/datetime string the way a person would say it:
 * `2015-08-15` → "Aug 15, 2015", `2015-08-15 14:30:00` → "Aug 15, 2015, 2:30 PM".
 * Formatted in UTC to match parseTemporal, so the shown date never drifts by
 * the viewer's timezone. Non-temporal input comes back unchanged.
 */
export function formatTemporal(v: string): string {
  const date = parseTemporal(v);
  if (!date) return v;
  const hasTime = /[ T]/.test(v.trim());
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** ISO dates/datetimes embedded in free text, for display-only rewriting. */
const TEMPORAL_IN_TEXT_RE = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/g;

/**
 * Rewrite machine-shaped dates inside prose for display: "trips on 2015-08-15"
 * → "trips on Aug 15, 2015". Only recognised ISO forms are touched; the rest of
 * the text passes through verbatim, and the underlying string is never mutated.
 */
export function humanizeDatesInText(text: string): string {
  return text.replace(TEMPORAL_IN_TEXT_RE, (m) => formatTemporal(m));
}

/**
 * A short date-context phrase pulled from the user's question, for captioning a
 * scalar answer: one ISO date → "on Aug 15, 2015", two → "from Aug 1, 2015 to
 * Aug 15, 2015". Empty when the question names no (or too many) ISO dates —
 * better no context than a wrong one.
 */
export function questionDateContext(question: string): string {
  const dates = question.match(TEMPORAL_IN_TEXT_RE) ?? [];
  if (dates.length === 1) return `on ${formatTemporal(dates[0])}`;
  if (dates.length === 2) return `from ${formatTemporal(dates[0])} to ${formatTemporal(dates[1])}`;
  return "";
}

/** Human-facing cell text: em-dash for null, grouped numbers, spoken dates, strings as-is. */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (isTemporalValue(v)) return formatTemporal((v as string).trim());
  const n = toNumber(v);
  if (n !== null) return formatNumber(n);
  return String(v);
}

/**
 * Hover title for a formatted cell: the RAW value, but only when formatting
 * loses information (decimals beyond 4 places, or a 64-bit integer string
 * past Number's safe range). Undefined when the display already shows the
 * exact value, so faithful cells don't grow a redundant tooltip.
 */
export function cellTitle(v: unknown): string | undefined {
  // Spoken dates always reshape the raw value, so hover shows the exact ISO form.
  if (isTemporalValue(v)) return (v as string).trim();
  const n = toNumber(v);
  if (n === null) return undefined;
  const raw = typeof v === "string" ? v.trim() : String(v);
  // Un-group the display and compare it to the raw value; equal ⇒ lossless.
  const shown = formatCell(v).replace(/,/g, "");
  return shown === raw ? undefined : raw;
}

/** Aggregate-function prefixes mapped to a readable English word. */
const AGG_WORDS: Record<string, string> = {
  count: "Count",
  avg: "Average",
  sum: "Total",
  min: "Minimum",
  max: "Maximum",
  uniq: "Unique",
  uniqexact: "Unique",
  median: "Median",
};

/**
 * Per-token rewrites applied when spelling out a column name, so dataset jargon
 * and SQL abbreviations read as plain English: `pickup_ntaname` →
 * "Pickup neighborhood", `avg_tip` → "Average tip", `pickup_datetime` →
 * "Pickup time". Keyed by lowercased token; unknown tokens pass through unchanged.
 */
const TOKEN_GLOSSARY: Record<string, string> = {
  ntaname: "neighborhood",
  nta: "neighborhood",
  datetime: "time",
  avg: "average",
  amt: "amount",
  pct: "percent",
  num: "number",
  qty: "quantity",
  usd: "USD",
  id: "ID",
};

/** Apply the glossary word-by-word to an already space-separated phrase. */
function glossTokens(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((w) => TOKEN_GLOSSARY[w.toLowerCase()] ?? w)
    .join(" ")
    .trim();
}

/**
 * Turn a raw SQL column expression into a human caption for a stat headline:
 * `count()` → "Count", `avg(passenger_count)` → "Average passenger count",
 * `total_amount` → "Total amount", `pickup_ntaname` → "Pickup neighborhood".
 * Leaves anything it doesn't recognise as a tidied, space-separated string
 * rather than a raw token.
 */
export function humanizeLabel(col: string): string {
  const label = col.trim();
  const call = /^([a-z_]+)\s*\((.*)\)$/i.exec(label);
  if (call) {
    const fn = call[1].toLowerCase();
    const rawInner = call[2].trim();
    // Every row of the app's one table (nyc_taxi) is a trip, so a bare row
    // count IS a trip count — "Trips" answers the question, "Count" doesn't.
    if (fn === "count" && (rawInner === "" || rawInner === "*")) return "Trips";
    const word = AGG_WORDS[fn];
    const inner = glossTokens(rawInner.replace(/_/g, " "));
    if (word) return inner ? `${word} ${inner}` : word;
  }
  const spaced = glossTokens(label.replace(/_/g, " ").trim());
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : label;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Pull ISO dates (`2015-08-15`) out of a prompt and return them as human
 * labels ("Aug 15, 2015"), deduped in order of appearance. The prompt itself
 * stays verbatim — it's an eval fixture the model is graded on parsing — so
 * the labels render alongside it, not in place of it. Empty when the prompt
 * has no ISO dates; natural-language dates need no translation.
 */
export function humanDateLabels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const month = MONTH_SHORT[Number(m[2]) - 1];
    if (!month || Number(m[3]) < 1 || Number(m[3]) > 31) continue;
    const label = `${month} ${Number(m[3])}, ${m[1]}`;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** Compact absolute timestamp for the history panel (e.g. "Jun 9, 14:23"). */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Conversational timestamp for the history panel ("just now", "2 hr ago",
 * "yesterday"); past a week the absolute date is more useful than "9 days ago",
 * so it falls back to formatTimestamp. Pair with a title= of the absolute time.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const mins = Math.floor((now - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatTimestamp(ts);
}

/**
 * Dollar columns in nyc_taxi, by token: fare_amount, tip_amount, tolls_amount,
 * total_amount, extra, mta_tax, improvement_surcharge. "amount" alone catches
 * the aliased aggregates (`avg(tip_amount)`, `sum_total_amount`).
 */
const CURRENCY_TOKEN_RE = /\b(fare|tip|tips|tolls?|amount|amt|surcharge|tax|revenue|cost|price|usd)\b/i;
const DISTANCE_TOKEN_RE = /\b(distance|miles?|mi)\b/i;

export type StatUnit = "currency" | "distance" | null;

/** Infer a display unit from a column label so headline stats read as "$4.20" / "2.3 mi". */
export function statUnit(label: string): StatUnit {
  const words = label.replace(/[_()]/g, " ");
  if (CURRENCY_TOKEN_RE.test(words)) return "currency";
  if (DISTANCE_TOKEN_RE.test(words)) return "distance";
  return null;
}

/** Apply an inferred unit to an already-formatted numeric string. */
export function withUnit(formatted: string, unit: StatUnit): string {
  if (unit === "currency") return formatted.startsWith("-") ? `-$${formatted.slice(1)}` : `$${formatted}`;
  if (unit === "distance") return `${formatted} mi`;
  return formatted;
}

/** Dollars read best with exactly two decimals; counts of cents don't exist here. */
export function formatCurrencyNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
