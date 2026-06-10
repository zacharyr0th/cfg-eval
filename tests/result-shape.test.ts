import { describe, expect, it } from "vitest";
import { detectShape, defaultView, measureColumns } from "@/lib/result-shape";
import { formatCompact } from "@/lib/format";

/**
 * Pure shape-detection + default-view logic — no API or DB, so these run on every
 * `vitest run` (unlike the RUN_EVALS-gated end-to-end suites).
 */

describe("detectShape", () => {
  it("treats one row × one column as a scalar", () => {
    const shape = detectShape(["trips"], [["20825"]]); // ClickHouse quotes 64-bit ints
    expect(shape.kind).toBe("scalar");
    if (shape.kind === "scalar") {
      expect(shape.stat).toEqual({ label: "trips", value: "20825", numeric: true });
    }
  });

  it("treats one row × several columns (with a number) as metrics", () => {
    const shape = detectShape(
      ["total_fares", "total_trips", "avg_distance"],
      [["167617057.06", "20825", "2.9"]],
    );
    expect(shape.kind).toBe("metrics");
    if (shape.kind === "metrics") {
      expect(shape.stats).toHaveLength(3);
      expect(shape.stats.map((s) => s.label)).toEqual(["total_fares", "total_trips", "avg_distance"]);
      expect(shape.stats.every((s) => s.numeric)).toBe(true);
    }
  });

  it("keeps a single row of pure labels as a table (no numeric cell)", () => {
    expect(detectShape(["a", "b"], [["foo", "bar"]]).kind).toBe("table");
  });

  it("falls back to a table when a single row is too wide for cards", () => {
    const cols = Array.from({ length: 8 }, (_, i) => `c${i}`);
    const row = cols.map((_, i) => String(i));
    expect(detectShape(cols, [row]).kind).toBe("table");
  });

  it("treats multi-row and empty results as tables", () => {
    expect(detectShape(["hour", "trips"], [["0", "1"], ["1", "2"]]).kind).toBe("table");
    expect(detectShape(["x"], []).kind).toBe("table");
  });
});

describe("defaultView", () => {
  it("opens scalar and metrics results as stat cards", () => {
    const base = { chartable: false, temporalDefault: false, rowCount: 1 };
    expect(defaultView({ ...base, shape: "scalar" })).toBe("stat");
    expect(defaultView({ ...base, shape: "metrics" })).toBe("stat");
  });

  it("opens time series as a chart", () => {
    expect(
      defaultView({ shape: "table", chartable: true, temporalDefault: true, rowCount: 720 }),
    ).toBe("chart");
  });

  it("opens a small categorical top-N as a chart but a long tail as a table", () => {
    expect(
      defaultView({ shape: "table", chartable: true, temporalDefault: false, rowCount: 5 }),
    ).toBe("chart");
    expect(
      defaultView({ shape: "table", chartable: true, temporalDefault: false, rowCount: 200 }),
    ).toBe("table");
  });

  it("falls back to a table when nothing is chartable", () => {
    expect(
      defaultView({ shape: "table", chartable: false, temporalDefault: false, rowCount: 50 }),
    ).toBe("table");
  });
});

describe("measureColumns", () => {
  const rows2 = [
    ["0", "100"],
    ["1", "250"],
  ];

  it("bars the measure but not a numeric dimension axis", () => {
    // (hour, trips) — both numeric, but hour is the dimension, so only trips.
    expect(measureColumns(["hour", "trips"], rows2)).toEqual([1]);
  });

  it("bars the value beside a categorical or temporal label", () => {
    expect(measureColumns(["neighborhood", "avg_tip"], [["A", "1.2"], ["B", "3.4"]])).toEqual([1]);
    expect(measureColumns(["day", "trips"], [["2015-08-15", "9"], ["2015-08-16", "8"]])).toEqual([1]);
  });

  it("bars every measure when several sit beside one label", () => {
    expect(
      measureColumns(["payment_type", "fares", "trips"], [["Cash", "10", "2"], ["Card", "20", "5"]]),
    ).toEqual([1, 2]);
  });

  it("bars a lone numeric column and nothing in an all-text result", () => {
    expect(measureColumns(["n"], [["1"], ["2"]])).toEqual([0]);
    expect(measureColumns(["a", "b"], [["x", "y"], ["p", "q"]])).toEqual([]);
  });
});

describe("formatCompact", () => {
  it("abbreviates with SI suffixes", () => {
    expect(formatCompact(167_617_057)).toBe("167.6M");
    expect(formatCompact(1_500)).toBe("1.5K");
  });
});
