/**
 * Canonical positive and negative SQL examples for the Lark grammar in
 * lib/grammar/taxi.ts. Both grammar.test.ts (this directory) and any future
 * end-to-end evals can reuse these.
 *
 * Positive: queries the grammar should accept and ClickHouse should execute
 * cleanly. Negative: SQL that must be rejected — the grammar is the security
 * boundary, so any negative case parsing is a real failure.
 */

export const POSITIVE_QUERIES: string[] = [
  // Simple counts
  "SELECT count() FROM nyc_taxi",
  "SELECT count(*) FROM default.nyc_taxi",

  // Aggregate with WHERE on date range
  "SELECT sum(total_amount) FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'",

  // GROUP BY with alias + date function
  "SELECT toDate(pickup_datetime) AS day, count() FROM nyc_taxi GROUP BY day ORDER BY day",

  // Top-N pattern
  "SELECT pickup_ntaname, avg(tip_amount) AS avg_tip FROM nyc_taxi GROUP BY pickup_ntaname ORDER BY avg_tip DESC LIMIT 10",

  // Enum filtering with IN
  "SELECT payment_type, count() FROM nyc_taxi WHERE payment_type IN ('CRE','CSH') GROUP BY payment_type",

  // HAVING clause on alias
  "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING trips > 1000 ORDER BY trips DESC LIMIT 5",

  // Arithmetic inside aggregate
  "SELECT avg(tip_amount / total_amount) FROM nyc_taxi WHERE total_amount > 0",

  // IS NULL predicate on a Nullable column
  "SELECT count() FROM nyc_taxi WHERE passenger_count IS NULL",

  // Hour-of-day breakdown
  "SELECT toHour(pickup_datetime) AS hour, count() FROM nyc_taxi GROUP BY hour ORDER BY hour",

  // Column-vs-column comparison
  "SELECT count() FROM nyc_taxi WHERE tip_amount > fare_amount",

  // Arithmetic inside a WHERE predicate
  "SELECT count() FROM nyc_taxi WHERE tip_amount / fare_amount > 0.2 AND fare_amount > 0",

  // Aggregate arithmetic in HAVING
  "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING sum(tip_amount) / sum(fare_amount) > 0.2",

  // NOT variants
  "SELECT count() FROM nyc_taxi WHERE payment_type NOT IN ('CSH','UNK')",
  "SELECT count() FROM nyc_taxi WHERE fare_amount NOT BETWEEN 20 AND 50",
  "SELECT count() FROM nyc_taxi WHERE NOT (passenger_count IS NULL)",

  // Distinct-count aggregates
  "SELECT uniqExact(pickup_ntaname) FROM nyc_taxi",
];

export const NEGATIVE_QUERIES: Array<{ category: string; sql: string }> = [
  // DDL
  { category: "ddl", sql: "DROP TABLE nyc_taxi" },
  { category: "ddl", sql: "TRUNCATE TABLE nyc_taxi" },

  // DML
  { category: "dml", sql: "INSERT INTO nyc_taxi VALUES (1)" },
  { category: "dml", sql: "DELETE FROM nyc_taxi WHERE trip_id = 1" },

  // Multi-statement
  { category: "multi-statement", sql: "SELECT count() FROM nyc_taxi;" },
  { category: "multi-statement", sql: "SELECT 1; DROP TABLE nyc_taxi" },

  // Comments
  { category: "comment", sql: "SELECT count() FROM nyc_taxi -- evil" },
  { category: "comment", sql: "SELECT count() FROM nyc_taxi /* evil */" },

  // Subqueries
  { category: "subquery", sql: "SELECT count() FROM (SELECT * FROM nyc_taxi)" },
  { category: "subquery", sql: "SELECT count() FROM nyc_taxi WHERE fare_amount > (SELECT 1)" },

  // UNION
  { category: "union", sql: "SELECT count() FROM nyc_taxi WHERE fare_amount > 5 UNION SELECT 1" },

  // JOIN
  { category: "join", sql: "SELECT count() FROM nyc_taxi JOIN other ON nyc_taxi.trip_id = other.id" },

  // Disallowed columns (lat/long are out of scope in v1)
  { category: "blocked-column", sql: "SELECT pickup_longitude FROM nyc_taxi" },

  // Wrong table
  { category: "wrong-table", sql: "SELECT count() FROM users" },

  // Lowercase keywords (grammar requires uppercase)
  { category: "case", sql: "select count() from nyc_taxi" },

  // SELECT * bypasses the projection whitelist (lat/long would be returned)
  { category: "select-star", sql: "SELECT * FROM nyc_taxi" },

  // SQL keywords must not be valid aliases (IDENTIFIER is lowercase-only)
  { category: "keyword-alias", sql: "SELECT count() AS AND FROM nyc_taxi" },

  // Nested aggregates are rejected by ClickHouse and now by the grammar too
  { category: "nested-agg", sql: "SELECT sum(count()) FROM nyc_taxi" },
];
