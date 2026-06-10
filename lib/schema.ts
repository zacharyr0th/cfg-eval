/**
 * Client-safe, structured view of the dataset the query page exposes.
 *
 * Mirrors `NYC_TAXI_SCHEMA_DESCRIPTION` in `lib/grammar/taxi.ts` (the grammar is
 * the source of truth for what's *queryable*); duplicated here as plain data so
 * the schema disclosure panel can render without importing the server grammar
 * string into the client bundle. Keep the two in sync when columns change.
 */

export const DATASET = {
  table: "default.nyc_taxi",
  rowCount: "20M trips",
  engine: "ClickHouse MergeTree",
  rangeStart: "2015-07-01",
  rangeEnd: "2015-09-30",
} as const;

export interface SchemaColumn {
  name: string;
  type: string;
  note?: string;
}

export const SCHEMA_COLUMNS: readonly SchemaColumn[] = [
  { name: "trip_id", type: "UInt32" },
  { name: "pickup_datetime", type: "DateTime" },
  { name: "dropoff_datetime", type: "DateTime" },
  { name: "passenger_count", type: "Nullable(UInt8)" },
  { name: "trip_distance", type: "Nullable(Float32)", note: "miles" },
  { name: "fare_amount", type: "Float32", note: "base fare, USD" },
  { name: "extra", type: "Float32", note: "surcharges, USD" },
  { name: "tip_amount", type: "Float32", note: "USD" },
  { name: "tolls_amount", type: "Float32", note: "USD" },
  { name: "total_amount", type: "Float32", note: "fare + extra + tip + tolls" },
  { name: "payment_type", type: "Enum8", note: "CSH · CRE · NOC · DIS · UNK" },
  { name: "pickup_ntaname", type: "LowCardinality(String)", note: "pickup neighborhood" },
  { name: "dropoff_ntaname", type: "LowCardinality(String)", note: "dropoff neighborhood" },
] as const;

export const PAYMENT_TYPES: readonly { code: string; label: string }[] = [
  { code: "CSH", label: "cash" },
  { code: "CRE", label: "credit card" },
  { code: "NOC", label: "no charge" },
  { code: "DIS", label: "dispute" },
  { code: "UNK", label: "unknown" },
] as const;

/** lat/long exist in the table but are out of scope (no geo in v1): kept out of the projection by the grammar and out of predicates by the runtime guard (lib/sql-guard.ts). */
export const SCHEMA_NOTE =
  "SELECT-only, single table, no joins or subqueries — enforced at decode time by the grammar.";
