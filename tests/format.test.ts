import { describe, expect, it } from "vitest";
import {
  cellTitle,
  formatCell,
  formatCurrencyNumber,
  formatRelativeTime,
  formatTemporal,
  humanizeDatesInText,
  humanizeLabel,
  questionDateContext,
  statUnit,
  withUnit,
} from "@/lib/format";

describe("formatTemporal", () => {
  it("renders a date the way a person says it", () => {
    expect(formatTemporal("2015-08-15")).toBe("Aug 15, 2015");
  });

  it("keeps the time for datetimes, in UTC", () => {
    expect(formatTemporal("2015-08-15 14:30:00")).toBe("Aug 15, 2015, 2:30 PM");
    expect(formatTemporal("2015-08-15T00:05")).toBe("Aug 15, 2015, 12:05 AM");
  });

  it("passes non-temporal input through unchanged", () => {
    expect(formatTemporal("not a date")).toBe("not a date");
  });
});

describe("formatCell with temporal values", () => {
  it("humanizes date cells and keeps the raw ISO on hover", () => {
    expect(formatCell("2015-08-15")).toBe("Aug 15, 2015");
    expect(cellTitle("2015-08-15")).toBe("2015-08-15");
  });

  it("still formats numbers and nulls as before", () => {
    expect(formatCell("370379")).toBe("370,379");
    expect(formatCell(null)).toBe("—");
  });
});

describe("humanizeDatesInText", () => {
  it("rewrites ISO dates inside prose", () => {
    expect(humanizeDatesInText("How many trips happened on 2015-08-15?")).toBe(
      "How many trips happened on Aug 15, 2015?",
    );
  });

  it("rewrites every date and leaves the rest verbatim", () => {
    expect(humanizeDatesInText("between 2015-07-01 and 2015-09-30")).toBe(
      "between Jul 1, 2015 and Sep 30, 2015",
    );
  });

  it("does not touch text without ISO dates", () => {
    const q = "Which neighborhood had the most pickups?";
    expect(humanizeDatesInText(q)).toBe(q);
  });
});

describe("questionDateContext", () => {
  it("phrases a single date as 'on …'", () => {
    expect(questionDateContext("trips on 2015-08-15?")).toBe("on Aug 15, 2015");
  });

  it("phrases two dates as a range", () => {
    expect(questionDateContext("trips from 2015-07-01 to 2015-07-31")).toBe(
      "from Jul 1, 2015 to Jul 31, 2015",
    );
  });

  it("stays empty for zero or 3+ dates rather than guessing", () => {
    expect(questionDateContext("trips in August")).toBe("");
    expect(questionDateContext("2015-07-01 2015-08-01 2015-09-01")).toBe("");
  });
});

describe("humanizeLabel", () => {
  it("maps a bare row count to Trips — every nyc_taxi row is a trip", () => {
    expect(humanizeLabel("count()")).toBe("Trips");
    expect(humanizeLabel("count(*)")).toBe("Trips");
  });

  it("keeps argumented aggregates spelled out", () => {
    expect(humanizeLabel("avg(tip_amount)")).toBe("Average tip amount");
    expect(humanizeLabel("pickup_ntaname")).toBe("Pickup neighborhood");
  });
});

describe("stat units", () => {
  it("detects dollar and distance columns", () => {
    expect(statUnit("avg(tip_amount)")).toBe("currency");
    expect(statUnit("sum(total_amount)")).toBe("currency");
    expect(statUnit("avg(trip_distance)")).toBe("distance");
    expect(statUnit("count()")).toBeNull();
    expect(statUnit("avg(passenger_count)")).toBeNull();
  });

  it("applies units, keeping the minus sign outside the dollar", () => {
    expect(withUnit("4.20", "currency")).toBe("$4.20");
    expect(withUnit("-4.20", "currency")).toBe("-$4.20");
    expect(withUnit("2.3", "distance")).toBe("2.3 mi");
    expect(withUnit("42", null)).toBe("42");
  });

  it("formats dollars with exactly two decimals", () => {
    expect(formatCurrencyNumber(4.2)).toBe("4.20");
    expect(formatCurrencyNumber(1234.5678)).toBe("1,234.57");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 5, 10, 12, 0, 0);
  it("speaks recency instead of timestamps", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe("2 hr ago");
    expect(formatRelativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  });
});
