import { describe, expect, it } from "vitest";
import { extractIdentifiers, schemaViolations } from "./sql-introspect";
import { EVAL_CASES } from "./eval-cases";
import { POSITIVE_QUERIES } from "./grammar-cases";

/**
 * Offline tests for the introspection helpers behind eval #3 (schema adherence).
 * No API / DB — pure string analysis — so these run in the default `vitest run`
 * and lock the matcher down before it gates real model output.
 */

describe("extractIdentifiers", () => {
  it("distinguishes function calls from columns", () => {
    const uses = extractIdentifiers("SELECT count(), avg(tip_amount) FROM nyc_taxi");
    const fns = uses.filter((u) => u.isFunction).map((u) => u.name);
    const ids = uses.filter((u) => !u.isFunction).map((u) => u.name);
    expect(fns).toEqual(expect.arrayContaining(["count", "avg"]));
    expect(ids).toEqual(expect.arrayContaining(["tip_amount", "nyc_taxi"]));
  });

  it("ignores identifiers inside string literals", () => {
    const uses = extractIdentifiers("SELECT count() FROM nyc_taxi WHERE payment_type = 'CRE'");
    // 'CRE' must not surface as an identifier.
    expect(uses.map((u) => u.name)).not.toContain("CRE");
  });
});

describe("schemaViolations — adherent queries are clean", () => {
  it.each(POSITIVE_QUERIES)("no violations: %s", (sql) => {
    expect(schemaViolations(sql)).toEqual([]);
  });

  it.each(EVAL_CASES)("reference SQL is fully grounded: $id", (c) => {
    expect(schemaViolations(c.referenceSQL), JSON.stringify(schemaViolations(c.referenceSQL))).toEqual([]);
  });

  it("accepts aliases referenced downstream", () => {
    const sql = "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING trips > 100 ORDER BY trips DESC";
    expect(schemaViolations(sql)).toEqual([]);
  });

  it("accepts the default.nyc_taxi qualified table", () => {
    expect(schemaViolations("SELECT count() FROM default.nyc_taxi")).toEqual([]);
  });
});

describe("schemaViolations — hallucinations are caught", () => {
  it("flags an invented column", () => {
    const v = schemaViolations("SELECT trip_date FROM nyc_taxi");
    expect(v).toContainEqual({ token: "trip_date", kind: "unknown-column" });
  });

  it("flags the deliberately-excluded geo columns", () => {
    const v = schemaViolations("SELECT avg(pickup_latitude), avg(pickup_longitude) FROM nyc_taxi");
    const tokens = v.map((x) => x.token);
    expect(tokens).toEqual(expect.arrayContaining(["pickup_latitude", "pickup_longitude"]));
  });

  it("flags an invented function", () => {
    const v = schemaViolations("SELECT dateDiff('day', pickup_datetime, dropoff_datetime) FROM nyc_taxi");
    expect(v).toContainEqual({ token: "dateDiff", kind: "unknown-function" });
  });

  it("flags a non-existent table", () => {
    const v = schemaViolations("SELECT count() FROM drivers");
    expect(v).toContainEqual({ token: "drivers", kind: "unknown-column" });
  });
});

// The discrimination contract for the adversarial + phantom-column eval slices:
// these are the exact fabrications a baseline tends to emit on those prompts.
// The grammar forecloses every one by construction, so an unconstrained miss is
// a measurable schema violation here. Locking the tokens down offline means the
// head-to-head's "schemaClean" gap is guaranteed to register if the baseline
// drifts — independent of whether any given model run happens to drift.
describe("schemaViolations — catches the drifts the adversarial/phantom slices tempt", () => {
  it("flags dateDiff() — the duration/speed prompts tempt it (no duration column)", () => {
    const v = schemaViolations(
      "SELECT avg(dateDiff('minute', pickup_datetime, dropoff_datetime)) FROM nyc_taxi",
    );
    expect(v).toContainEqual({ token: "dateDiff", kind: "unknown-function" });
  });

  it("flags an invented trip_duration / speed column", () => {
    expect(schemaViolations("SELECT avg(trip_duration) FROM nyc_taxi")).toContainEqual({
      token: "trip_duration",
      kind: "unknown-column",
    });
    expect(schemaViolations("SELECT avg(speed_mph) FROM nyc_taxi")).toContainEqual({
      token: "speed_mph",
      kind: "unknown-column",
    });
  });

  it("flags phantom NYC-TLC columns absent from this 13-column subset", () => {
    for (const col of ["mta_tax", "improvement_surcharge", "store_and_fwd_flag"]) {
      expect(schemaViolations(`SELECT sum(${col}) FROM nyc_taxi`)).toContainEqual({
        token: col,
        kind: "unknown-column",
      });
    }
    // VendorID / RatecodeID — checked case-insensitively, flagged as columns.
    expect(schemaViolations("SELECT VendorID, count() FROM nyc_taxi GROUP BY VendorID")).toContainEqual({
      token: "VendorID",
      kind: "unknown-column",
    });
  });

  it("flags median()/quantile() — outside the aggregate whitelist", () => {
    expect(schemaViolations("SELECT median(fare_amount) FROM nyc_taxi")).toContainEqual({
      token: "median",
      kind: "unknown-function",
    });
    expect(schemaViolations("SELECT quantile(0.5)(fare_amount) FROM nyc_taxi")).toContainEqual({
      token: "quantile",
      kind: "unknown-function",
    });
  });

  it("does NOT flag the correct constrained answers to those prompts", () => {
    // Duration in minutes and cost-per-mile, expressed within the schema.
    expect(schemaViolations("SELECT avg((dropoff_datetime - pickup_datetime) / 60) FROM nyc_taxi")).toEqual([]);
    expect(
      schemaViolations("SELECT avg(total_amount / trip_distance) FROM nyc_taxi WHERE trip_distance > 1"),
    ).toEqual([]);
  });
});
