/**
 * Defense-in-depth validator for the "edit & re-run" escape hatch on /query.
 *
 * Generated SQL is grammar-constrained and provably safe; *edited* SQL is
 * arbitrary user input, so before it reaches ClickHouse we re-assert the same
 * envelope the grammar guarantees: one SELECT statement, against nyc_taxi, with
 * no statement chaining, comments, or DDL/DML verbs. ClickHouse is additionally
 * asked to run it `readonly` (see runQuery) — this guard is the belt, that's the
 * suspenders. Throws an Error with a user-facing message on rejection.
 */

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|ATTACH|DETACH|TRUNCATE|RENAME|GRANT|REVOKE|OPTIMIZE|SYSTEM|KILL|INTO|OUTFILE)\b/i;

/**
 * Table / dictionary functions that read from *outside* the local table — remote
 * hosts, object stores, other databases, the local filesystem. ClickHouse's
 * `readonly` mode does NOT block these (they're reads, not writes), so they're a
 * live SSRF / cross-source exfiltration vector that the guard must reject itself.
 * Matched in their call form (`name(`) so a same-named column couldn't trip them.
 */
const TABLE_FUNCTIONS =
  /\b(url|remote|remoteSecure|cluster|clusterAllReplicas|s3|s3Cluster|gcs|file|hdfs|hdfsCluster|mysql|postgresql|mongodb|redis|sqlite|jdbc|odbc|azureBlobStorage|azureBlobStorageCluster|deltaLake|hudi|iceberg|dictionary|input|merge|numbers|generateRandom|view|viewIfPermitted|executable|loop)\s*\(/i;

/**
 * The query must read FROM the nyc_taxi table *structurally* (a real FROM clause),
 * not merely mention the word somewhere — a bare `\bnyc_taxi\b` check is satisfied
 * by a string literal like `WHERE 'nyc_taxi' != ''`, which would let an attacker
 * pair an SSRF table function with a decoy mention to pass the guard.
 */
const FROM_NYC_TAXI = /\bFROM\s+(?:default\s*\.\s*)?nyc_taxi\b/i;

/**
 * Latitude/longitude columns physically exist in the underlying nyc_taxi table
 * but are deliberately out of scope for v1 ("no geo"). The grammar keeps them
 * out of the *projection* (they aren't in the column whitelist), but its
 * IDENTIFIER fallback — present so GROUP BY / ORDER BY / HAVING can reference
 * SELECT aliases — also accepts a bare geo column name inside a predicate, and a
 * context-free grammar can't tell an alias from a stray column. So this is the
 * layer that enforces "no geo": reject any identifier ending in `latitude` /
 * `longitude`. Unlike a typo'd column (which errors on ClickHouse), a real geo
 * column would otherwise execute and return data, so it has to be caught here.
 */
const GEO_COLUMN = /\b\w*(?:latitude|longitude)\b/i;

const MAX_LEN = 4000;

export function assertSafeSelect(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, ""); // tolerate one trailing semicolon
  if (!trimmed) throw new Error("Query is empty.");
  if (trimmed.length > MAX_LEN) throw new Error(`Query exceeds ${MAX_LEN} characters.`);
  if (trimmed.includes(";")) throw new Error("Only a single statement is allowed — remove the semicolon.");
  if (/--|\/\*|\*\//.test(trimmed)) throw new Error("Comments are not allowed.");
  if (!/^select\b/i.test(trimmed)) throw new Error("Only SELECT queries can be run.");
  if (!FROM_NYC_TAXI.test(trimmed)) throw new Error("Queries must read FROM the nyc_taxi table.");
  if (TABLE_FUNCTIONS.test(trimmed)) throw new Error("Table functions (url, remote, s3, file, …) are not allowed.");
  if (FORBIDDEN.test(trimmed)) throw new Error("Only read-only SELECT queries against nyc_taxi are allowed.");
  // Checked with string literals blanked so a neighborhood name that happens to
  // contain "latitude"/"longitude" can't trip the geo guard.
  const withoutStrings = trimmed.replace(/'(?:[^']|'')*'/g, "''");
  if (GEO_COLUMN.test(withoutStrings)) {
    throw new Error("Latitude/longitude columns are out of scope — this dataset view excludes geo (no geo in v1).");
  }
  return trimmed;
}
