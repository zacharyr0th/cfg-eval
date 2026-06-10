#!/usr/bin/env python3
r"""Validate SQL examples against the Lark grammar in lib/grammar/taxi.ts.

Single source of truth: the ``NYC_TAXI_LARK = String.raw`...```` template literal
in lib/grammar/taxi.ts. This script extracts it, builds a Lark parser, and
runs each line of stdin (or files passed as args) through it. Exits non-zero
if any expected-positive case fails, or any expected-negative case parses.

Usage from the project root:
    .venv/bin/python3 scripts/check_grammar.py            # runs built-in self-tests
    echo "SELECT count() FROM nyc_taxi" | .venv/bin/python3 scripts/check_grammar.py -
    .venv/bin/python3 scripts/check_grammar.py path/to/queries.sql

Exit codes:
    0  all positive cases parse, all negative cases reject
    1  at least one case behaved unexpectedly
    2  the grammar itself failed to load (a bug in taxi.ts)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from lark import Lark, UnexpectedInput

ROOT = Path(__file__).resolve().parent.parent
TAXI_TS = ROOT / "lib" / "grammar" / "taxi.ts"


def load_grammar() -> str:
    text = TAXI_TS.read_text()
    # Extract the String.raw`...` payload for NYC_TAXI_LARK.
    m = re.search(
        r"export const NYC_TAXI_LARK = String\.raw`(.*?)`\.trim\(\);",
        text,
        re.DOTALL,
    )
    if not m:
        print("ERROR: could not find NYC_TAXI_LARK template literal in taxi.ts", file=sys.stderr)
        sys.exit(2)
    return m.group(1).strip()


def build_parser() -> Lark:
    grammar = load_grammar()
    # Earley unconditionally. The grammar uses explicit whitespace terminals
    # (per the OpenAI CFG cookbook's "thread whitespace explicitly" guidance),
    # which creates LALR-1 shift-reduce conflicts wherever an optional
    # `(WS X)?` precedes another `WS Y` in the outer rule (alias, DIRECTION,
    # IS [NOT] NULL). Lark's LALR resolves these as shift by default and
    # silently produces a parser that rejects valid queries. Earley explores
    # both paths and parses the grammar as written. LLGuidance — OpenAI's
    # constraint engine — is not LALR-bound and accepts the same grammar.
    return Lark(grammar, start="start", parser="earley")


def tries_to_parse(parser: Lark, sql: str) -> tuple[bool, str | None]:
    try:
        parser.parse(sql)
        return True, None
    except UnexpectedInput as exc:
        return False, str(exc).splitlines()[0]


# Built-in self-test set covering positive and negative cases. Run when invoked
# without args; otherwise the script just parses stdin / files.
POSITIVE: list[str] = [
    "SELECT count() FROM nyc_taxi",
    "SELECT count(*) FROM default.nyc_taxi",
    "SELECT sum(total_amount) FROM nyc_taxi WHERE pickup_datetime BETWEEN '2015-08-01 00:00:00' AND '2015-08-31 23:59:59'",
    "SELECT toDate(pickup_datetime) AS day, count() FROM nyc_taxi GROUP BY day ORDER BY day",
    "SELECT pickup_ntaname, avg(tip_amount) AS avg_tip FROM nyc_taxi GROUP BY pickup_ntaname ORDER BY avg_tip DESC LIMIT 10",
    "SELECT payment_type, count() FROM nyc_taxi WHERE payment_type IN ('CRE','CSH') GROUP BY payment_type",
    "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING trips > 1000 ORDER BY trips DESC LIMIT 5",
    "SELECT avg(tip_amount / total_amount) FROM nyc_taxi WHERE total_amount > 0",
    "SELECT count() FROM nyc_taxi WHERE passenger_count IS NULL",
    "SELECT toHour(pickup_datetime) AS hour, count() FROM nyc_taxi GROUP BY hour ORDER BY hour",
    # Expression predicates (column-vs-column, arithmetic) and NOT variants
    "SELECT count() FROM nyc_taxi WHERE tip_amount > fare_amount",
    "SELECT count() FROM nyc_taxi WHERE tip_amount / fare_amount > 0.2 AND fare_amount > 0",
    "SELECT pickup_ntaname, count() AS trips FROM nyc_taxi GROUP BY pickup_ntaname HAVING sum(tip_amount) / sum(fare_amount) > 0.2",
    "SELECT count() FROM nyc_taxi WHERE payment_type NOT IN ('CSH','UNK')",
    "SELECT count() FROM nyc_taxi WHERE fare_amount NOT BETWEEN 20 AND 50",
    "SELECT count() FROM nyc_taxi WHERE NOT (passenger_count IS NULL)",
    "SELECT uniqExact(pickup_ntaname) FROM nyc_taxi",
]

NEGATIVE: list[str] = [
    # DDL
    "DROP TABLE nyc_taxi",
    "TRUNCATE TABLE nyc_taxi",
    # DML
    "INSERT INTO nyc_taxi VALUES (1)",
    "DELETE FROM nyc_taxi WHERE trip_id = 1",
    # Multi-statement / semicolon
    "SELECT count() FROM nyc_taxi;",
    "SELECT 1; DROP TABLE nyc_taxi",
    # Comments
    "SELECT count() FROM nyc_taxi -- evil",
    "SELECT count() FROM nyc_taxi /* evil */",
    # Subqueries
    "SELECT count() FROM (SELECT * FROM nyc_taxi)",
    "SELECT count() FROM nyc_taxi WHERE fare_amount > (SELECT 1)",
    # UNION
    "SELECT count() FROM nyc_taxi WHERE fare_amount > 5 UNION SELECT 1",
    # JOIN
    "SELECT count() FROM nyc_taxi JOIN other ON nyc_taxi.trip_id = other.id",
    # Disallowed column (lat/long)
    "SELECT pickup_longitude FROM nyc_taxi",
    # Wrong table
    "SELECT count() FROM users",
    # Lowercase keywords (grammar requires uppercase)
    "select count() from nyc_taxi",
    # SELECT * bypasses the projection whitelist (lat/long would be returned)
    "SELECT * FROM nyc_taxi",
    # SQL keywords must not be valid aliases (IDENTIFIER is lowercase-only)
    "SELECT count() AS AND FROM nyc_taxi",
    # Nested aggregates are rejected by ClickHouse and now by the grammar too
    "SELECT sum(count()) FROM nyc_taxi",
]


def run_self_tests(parser: Lark) -> int:
    failures = 0
    for sql in POSITIVE:
        ok, err = tries_to_parse(parser, sql)
        status = "OK" if ok else f"FAIL ({err})"
        print(f"[+] {status:30s}  {sql}")
        if not ok:
            failures += 1
    for sql in NEGATIVE:
        ok, _ = tries_to_parse(parser, sql)
        status = "FAIL (parsed)" if ok else "OK"
        print(f"[-] {status:30s}  {sql}")
        if ok:
            failures += 1
    if failures == 0:
        print(f"\n{len(POSITIVE)} positive + {len(NEGATIVE)} negative cases — all OK")
    else:
        print(f"\n{failures} unexpected outcome(s)", file=sys.stderr)
    return 1 if failures else 0


def main() -> int:
    parser = build_parser()
    args = sys.argv[1:]
    if not args:
        return run_self_tests(parser)
    # Each `-` reads the whole stdin as ONE query (model outputs are commonly
    # multi-line). Each file path reads the whole file as ONE query too. To
    # batch multiple queries, pass multiple `-`s or multiple paths.
    queries: list[str] = []
    for arg in args:
        if arg == "-":
            queries.append(sys.stdin.read().strip())
        else:
            queries.append(Path(arg).read_text().strip())
    failures = 0
    for sql in queries:
        if not sql:
            continue
        ok, err = tries_to_parse(parser, sql)
        single_line = " ".join(sql.split())
        print(f"{'OK' if ok else 'NO'}: {single_line}" + (f"  ({err})" if not ok else ""))
        if not ok:
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
