/**
 * Labelled NL → SQL eval set for default.nyc_taxi (2015-07-01 → 2015-09-30).
 *
 * Each case is a natural-language question paired with a reference SQL query.
 * The eval runs the model's SQL AND the reference SQL against ClickHouse and
 * compares the result sets — so the model gets credit for any semantically
 * equivalent query, not only an exact textual match (Execution Accuracy, the
 * Spider/BIRD-standard metric).
 *
 * `tags` are how the head-to-head eval slices the comparison ("does CFG help
 * more on date-arithmetic prompts than on simple counts?"). Add tags as new
 * prompt types are added. The `adversarial` tag marks the cases built to make
 * the UNCONSTRAINED baseline drift off-schema (invented columns, non-whitelisted
 * functions, ratio-of-sums-vs-avg-of-ratios) — the head-to-head reports this
 * slice separately, because that is the one axis where the grammar measurably
 * separates from a strong base model (clean prompts saturate both modes at 100%
 * and prove nothing).
 *
 * `difficulty` tiers the set (Spider/BIRD-style) so pass@N is reported per tier —
 * a set where everything scores 100% can't detect the regressions that matter.
 *
 * `distractors` are plausible-but-wrong queries used by the false-positive eval
 * (a static-dataset adaptation of test-suite accuracy, Zhong et al. 2020).
 *
 * `compare` controls the result-set comparison:
 *   - "set": rows compared as a set (order-insensitive, used for unordered aggs)
 *   - "ordered": exact row order (used when ORDER BY is part of the question)
 *   - "scalar": single-row, single-cell numeric comparison with tolerance
 */

import type { CompareMode } from "@/lib/result-compare";


/** Spider/BIRD-style difficulty tiers, for stratified pass@N reporting. */
export type Difficulty = "easy" | "medium" | "hard";

export interface EvalCase {
  id: string;
  question: string;
  /** Reference SQL — a known-good query against default.nyc_taxi. */
  referenceSQL: string;
  compare: CompareMode;
  /** Relative tolerance for "scalar" comparisons (default 0.0001). */
  tolerance?: number;
  tags: string[];
  /** Difficulty tier for stratified reporting. */
  difficulty: Difficulty;
  /**
   * Whether the answer axis (result-set match vs the reference) is graded.
   * Defaults to true. Set false for prompts that are answerable AND useful as
   * schema-drift probes but have NO canonical scalar answer — e.g. "average
   * trip duration / speed", where several equally-valid queries (truncated
   * dateDiff vs exact seconds, filtering the dataset's negative-duration garbage
   * rows or not) return materially different numbers (we measured avg speed
   * swinging from 12 to 143 mph across defensible filters). Exact-match
   * correctness is the wrong oracle there, so these cases are graded on
   * executability + schema-grounding only; the head-to-head still uses them for
   * the fabrication signal (the baseline reaches for dateDiff / a phantom
   * column; the grammar can't). The `referenceSQL` documents one valid
   * interpretation and proves the grammar can express the query.
   */
  gradeAnswer?: boolean;
  /**
   * "Distractor" queries: plausible-but-wrong SQL a confused model might emit
   * (sum vs avg, fare vs total, > vs >=, wrong date, reversed sort). The
   * false-positive eval asserts each distractor's result DIFFERS from a live run
   * of the referenceSQL, proving this case can actually fail a wrong query on
   * the (single, static) dataset — the spirit of test-suite accuracy (Zhong et
   * al. 2020) adapted to a fixed DB. If a distractor coincidentally matches the
   * reference answer, the case has a false-positive hole and the eval says so.
   */
  distractors?: string[];
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "count-day",
    question: "How many trips happened on 2015-08-15?",
    referenceSQL:
      "SELECT count() FROM nyc_taxi WHERE toDate(pickup_datetime) = '2015-08-15'",
    compare: "scalar",
    difficulty: "easy",
    tags: ["count", "date-filter"],
    // off-by-one day — a different date must yield a different count.
    distractors: ["SELECT count() FROM nyc_taxi WHERE toDate(pickup_datetime) = '2015-08-14'"],
  },
  {
    id: "sum-fares-day",
    question: "What were the total fares collected on 2015-08-15?",
    referenceSQL:
      "SELECT sum(fare_amount) FROM nyc_taxi WHERE toDate(pickup_datetime) = '2015-08-15'",
    compare: "scalar",
    tolerance: 0.01,
    difficulty: "easy",
    tags: ["sum", "date-filter"],
    // fare_amount vs total_amount — the classic column confusion.
    distractors: ["SELECT sum(total_amount) FROM nyc_taxi WHERE toDate(pickup_datetime) = '2015-08-15'"],
  },
  {
    id: "top-pickup-ntas-by-trips-aug",
    question: "Top 5 pickup neighborhoods by trip count in August 2015",
    referenceSQL:
      "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59' GROUP BY pickup_ntaname ORDER BY trips DESC LIMIT 5",
    compare: "ordered",
    difficulty: "medium",
    tags: ["top-n", "group-by", "date-range"],
    // ASC = bottom 5, not top 5.
    distractors: [
      "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59' GROUP BY pickup_ntaname ORDER BY trips ASC LIMIT 5",
    ],
  },
  {
    id: "hourly-count-aug15",
    question:
      "Trip count grouped by hour-of-day (an integer 0–23 via toHour) for trips picked up on 2015-08-15. Order by the hour ascending.",
    referenceSQL:
      "SELECT toHour(pickup_datetime) AS hour, count() AS trips FROM nyc_taxi WHERE toDate(pickup_datetime) = '2015-08-15' GROUP BY hour ORDER BY hour",
    compare: "ordered",
    difficulty: "medium",
    tags: ["group-by", "hour-bucket", "date-filter"],
    // wrong day — same query, different numbers.
    distractors: [
      "SELECT toHour(pickup_datetime) AS hour, count() AS trips FROM nyc_taxi WHERE toDate(pickup_datetime) = '2015-08-16' GROUP BY hour ORDER BY hour",
    ],
  },
  {
    id: "payment-type-breakdown",
    question:
      "For each payment_type, the sum of fare_amount — order rows by that sum descending.",
    referenceSQL:
      "SELECT payment_type, sum(fare_amount) AS total FROM nyc_taxi GROUP BY payment_type ORDER BY total DESC",
    compare: "ordered",
    difficulty: "medium",
    tags: ["group-by", "enum-filter"],
    // count() instead of sum(fare_amount) — different values and likely order.
    distractors: ["SELECT payment_type, count() AS total FROM nyc_taxi GROUP BY payment_type ORDER BY total DESC"],
  },
  {
    id: "avg-distance-long-trips",
    question: "Average trip distance for trips longer than 10 miles",
    referenceSQL:
      "SELECT avg(trip_distance) FROM nyc_taxi WHERE trip_distance > 10",
    compare: "scalar",
    tolerance: 0.01,
    difficulty: "easy",
    tags: ["avg", "where-filter"],
    // wrong threshold (5 vs 10 miles).
    distractors: ["SELECT avg(trip_distance) FROM nyc_taxi WHERE trip_distance > 5"],
  },
  {
    id: "credit-card-tip-rate-aug",
    question: "Average tip-to-fare ratio on credit-card trips in August 2015",
    referenceSQL:
      "SELECT avg(tip_amount / fare_amount) FROM nyc_taxi WHERE payment_type = 'CRE' AND fare_amount > 0 AND pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'",
    compare: "scalar",
    tolerance: 0.001,
    difficulty: "hard",
    tags: ["avg", "arithmetic", "enum-filter", "date-range"],
    // sum-of-ratios instead of avg-of-ratios — massively different magnitude.
    distractors: [
      "SELECT sum(tip_amount / fare_amount) FROM nyc_taxi WHERE payment_type = 'CRE' AND fare_amount > 0 AND pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'",
    ],
  },
  {
    id: "trips-by-passenger-count",
    question: "Trip count by passenger count, for trips with a known passenger count",
    referenceSQL:
      "SELECT passenger_count, count() AS trips FROM nyc_taxi WHERE passenger_count IS NOT NULL GROUP BY passenger_count ORDER BY passenger_count",
    compare: "ordered",
    difficulty: "medium",
    tags: ["group-by", "null-handling"],
    // > 0 wrongly drops the valid 0-passenger group.
    distractors: [
      "SELECT passenger_count, count() AS trips FROM nyc_taxi WHERE passenger_count > 0 GROUP BY passenger_count ORDER BY passenger_count",
    ],
  },
  {
    id: "max-fare",
    question: "What was the highest single fare amount in the dataset?",
    referenceSQL: "SELECT max(fare_amount) FROM nyc_taxi",
    compare: "scalar",
    tolerance: 0.01,
    difficulty: "easy",
    tags: ["min-max"],
    // min instead of max.
    distractors: ["SELECT min(fare_amount) FROM nyc_taxi"],
  },
  {
    id: "daily-trips-aug",
    question: "Trip count per day in August 2015",
    referenceSQL:
      "SELECT toDate(pickup_datetime) AS day, count() AS trips FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59' GROUP BY day ORDER BY day",
    compare: "ordered",
    difficulty: "medium",
    tags: ["group-by", "date-bucket", "date-range"],
    // wrong month (July, not August).
    distractors: [
      "SELECT toDate(pickup_datetime) AS day, count() AS trips FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-07-01 00:00:00' AND '2015-07-31 23:59:59' GROUP BY day ORDER BY day",
    ],
  },
  {
    id: "top-dropoff-ntas-by-revenue-jul",
    question: "Top 10 dropoff neighborhoods by total revenue in July 2015",
    referenceSQL:
      "SELECT dropoff_ntaname, sum(total_amount) AS revenue FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-07-01 00:00:00' AND '2015-07-31 23:59:59' GROUP BY dropoff_ntaname ORDER BY revenue DESC LIMIT 10",
    compare: "ordered",
    difficulty: "medium",
    tags: ["top-n", "group-by", "date-range", "sum"],
    // fare_amount instead of total_amount as "revenue".
    distractors: [
      "SELECT dropoff_ntaname, sum(fare_amount) AS revenue FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-07-01 00:00:00' AND '2015-07-31 23:59:59' GROUP BY dropoff_ntaname ORDER BY revenue DESC LIMIT 10",
    ],
  },
  {
    id: "trips-having-many",
    question: "Pickup neighborhoods with more than 50,000 trips overall, sorted by trip count descending",
    referenceSQL:
      "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING trips > 50000 ORDER BY trips DESC",
    compare: "ordered",
    difficulty: "hard",
    tags: ["having", "group-by"],
    // wrong HAVING threshold yields a different row set.
    distractors: [
      "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING trips > 100000 ORDER BY trips DESC",
    ],
  },

  /* ---- Hard tier: arithmetic, HAVING, and multi-condition filters --------- */
  {
    id: "avg-total-per-passenger-aug",
    question:
      "For trips in August 2015 with at least 2 passengers, what is the average total amount per passenger (total_amount divided by passenger_count)?",
    referenceSQL:
      "SELECT avg(total_amount / passenger_count) FROM nyc_taxi WHERE passenger_count >= 2 AND pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'",
    compare: "scalar",
    tolerance: 0.001,
    difficulty: "hard",
    tags: ["avg", "arithmetic", "where-filter", "date-range"],
    // stricter passenger floor → a different population, different average.
    distractors: [
      "SELECT avg(total_amount / passenger_count) FROM nyc_taxi WHERE passenger_count >= 3 AND pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'",
    ],
  },
  {
    id: "popular-cre-pickups",
    question:
      "Which pickup neighborhoods had more than 100,000 credit-card trips? Return the neighborhood and that trip count, highest first.",
    referenceSQL:
      "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi WHERE payment_type = 'CRE' GROUP BY pickup_ntaname HAVING trips > 100000 ORDER BY trips DESC",
    compare: "ordered",
    difficulty: "hard",
    tags: ["having", "group-by", "enum-filter"],
    // cash, not credit card.
    distractors: [
      "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi WHERE payment_type = 'CSH' GROUP BY pickup_ntaname HAVING trips > 100000 ORDER BY trips DESC",
    ],
  },
  {
    id: "midrange-fare-multipax-aug",
    question:
      "How many trips in August 2015 had a fare between $20 and $50 and more than 2 passengers?",
    referenceSQL:
      "SELECT count() FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59' AND fare_amount BETWEEN 20 AND 50 AND passenger_count > 2",
    compare: "scalar",
    difficulty: "hard",
    tags: ["count", "between", "multi-condition", "date-range"],
    // stricter passenger filter → fewer trips.
    distractors: [
      "SELECT count() FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59' AND fare_amount BETWEEN 20 AND 50 AND passenger_count > 4",
    ],
  },
  {
    id: "top-dropoffs-long-cre",
    question:
      "Top 10 dropoff neighborhoods by number of long trips (over 5 miles) paid by credit card, between July and August 2015.",
    referenceSQL:
      "SELECT dropoff_ntaname, count() AS trips FROM nyc_taxi WHERE trip_distance > 5 AND payment_type = 'CRE' AND pickup_datetime BETWEEN '2015-07-01 00:00:00' AND '2015-08-31 23:59:59' GROUP BY dropoff_ntaname ORDER BY trips DESC LIMIT 10",
    compare: "ordered",
    difficulty: "hard",
    tags: ["top-n", "group-by", "multi-condition", "date-range"],
    // wrong distance threshold (10 vs 5 miles).
    distractors: [
      "SELECT dropoff_ntaname, count() AS trips FROM nyc_taxi WHERE trip_distance > 10 AND payment_type = 'CRE' AND pickup_datetime BETWEEN '2015-07-01 00:00:00' AND '2015-08-31 23:59:59' GROUP BY dropoff_ntaname ORDER BY trips DESC LIMIT 10",
    ],
  },

  /* ---- Hard tier: expression predicates (column-vs-column, arithmetic) ---- */
  {
    id: "tip-exceeds-fare",
    question: "How many trips had a tip larger than the fare itself?",
    referenceSQL: "SELECT count() FROM nyc_taxi WHERE tip_amount > fare_amount",
    compare: "scalar",
    difficulty: "hard",
    tags: ["count", "column-comparison"],
    // tip > total_amount is a much rarer (near-impossible) condition.
    distractors: ["SELECT count() FROM nyc_taxi WHERE tip_amount > total_amount"],
  },
  {
    id: "high-tip-rate-cre-count",
    question:
      "Among credit-card trips with a positive fare, how many had a tip exceeding 30% of the fare?",
    referenceSQL:
      "SELECT count() FROM nyc_taxi WHERE payment_type = 'CRE' AND fare_amount > 0 AND tip_amount / fare_amount > 0.3",
    compare: "scalar",
    difficulty: "hard",
    tags: ["count", "arithmetic-predicate", "enum-filter"],
    // wrong ratio threshold (20% vs 30%).
    distractors: [
      "SELECT count() FROM nyc_taxi WHERE payment_type = 'CRE' AND fare_amount > 0 AND tip_amount / fare_amount > 0.2",
    ],
  },

  /* ======================================================================== */
  /*  Adversarial tier — answerable, but phrased to TEMPT the baseline off     */
  /*  schema. Each is answerable from the 13 columns (the reference parses the */
  /*  grammar), yet its natural phrasing nudges toward a column or function    */
  /*  the schema doesn't have:                                                 */
  /*    - "duration"/"speed" read like columns, but must be DERIVED from the   */
  /*      pickup/dropoff timestamps with arithmetic;                           */
  /*    - "cost per mile" tempts ratio-of-sums when the question asks for the  */
  /*      average of the per-trip ratio.                                       */
  /*  The unconstrained model tends to reach for dateDiff(), a fabricated      */
  /*  trip_duration/speed column, or sum()/sum() — all of which the grammar    */
  /*  forecloses by construction. This is the slice where CFG separates from   */
  /*  the baseline on answerable prompts; the head-to-head reports it on its   */
  /*  own. (Tagged `adversarial`; tier `hard`.)                                */
  /* ======================================================================== */
  {
    id: "avg-trip-duration-min",
    question:
      "Across all trips, what was the average trip duration in minutes (dropoff time minus pickup time)?",
    referenceSQL:
      "SELECT avg((dropoff_datetime - pickup_datetime) / 60) FROM nyc_taxi",
    compare: "scalar",
    tolerance: 0.001,
    difficulty: "hard",
    tags: ["adversarial", "avg", "datetime-arithmetic", "schema-drift"],
    // Schema-drift probe, NOT a correctness case: "average duration" has no
    // canonical value (dateDiff('minute') truncates to 14.9674; exact seconds/60
    // gives 14.9675; filtering the 201 negative-duration garbage rows shifts it
    // again). The signal here is grounding — the baseline reaches for dateDiff();
    // the grammar cannot, so it stays schema-clean. See gradeAnswer.
    gradeAnswer: false,
  },
  {
    id: "avg-cost-per-mile",
    question:
      "For trips longer than 1 mile, what was the average cost per mile — that is, the average of total_amount divided by trip_distance, per trip?",
    referenceSQL:
      "SELECT avg(total_amount / trip_distance) FROM nyc_taxi WHERE trip_distance > 1",
    compare: "scalar",
    tolerance: 0.001,
    difficulty: "hard",
    tags: ["adversarial", "avg", "arithmetic", "ratio-of-sums-trap"],
    // Ratio-of-sums (total revenue / total miles) instead of the average of the
    // per-trip ratio — a different number, and the classic aggregation near-miss.
    distractors: ["SELECT sum(total_amount) / sum(trip_distance) FROM nyc_taxi WHERE trip_distance > 1"],
  },
  {
    id: "avg-trip-speed-mph",
    question:
      "What was the average trip speed in miles per hour, using distance over elapsed time (skip trips with no elapsed time)?",
    referenceSQL:
      "SELECT avg(trip_distance / ((dropoff_datetime - pickup_datetime) / 3600)) FROM nyc_taxi WHERE dropoff_datetime > pickup_datetime",
    compare: "scalar",
    tolerance: 0.001,
    difficulty: "hard",
    tags: ["adversarial", "avg", "datetime-arithmetic", "schema-drift"],
    // Schema-drift probe, NOT a correctness case — even more ill-posed than
    // duration: with sub-minute trip times in the denominator, the unfiltered
    // average is a garbage 142 mph; filtering to ≥60s gives 28 mph; an hour-
    // truncated dateDiff gives 12 mph. No canonical answer, so graded on
    // grounding only (the baseline invents a speed column / dateDiff). See
    // gradeAnswer.
    gradeAnswer: false,
  },
];
