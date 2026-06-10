import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POSITIVE_QUERIES, NEGATIVE_QUERIES } from "./grammar-cases";

/**
 * Grammar tests — every POSITIVE_QUERIES entry must parse against the Lark
 * grammar in lib/grammar/taxi.ts; every NEGATIVE_QUERIES entry must NOT parse.
 *
 * The actual Lark parser lives in Python (scripts/check_grammar.py) because
 * no maintained JavaScript Lark port exists. The script is the same source
 * the model gets — it reads the grammar string out of lib/grammar/taxi.ts —
 * so passing here is solid evidence GPT-5 will accept the same shape.
 *
 * Run `python3 -m venv .venv && .venv/bin/pip install lark` once. Tests skip
 * gracefully (with a clear message) when the venv is missing.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PYTHON = `${ROOT}/.venv/bin/python3`;
const SCRIPT = `${ROOT}/scripts/check_grammar.py`;
const VENV_READY = existsSync(PYTHON);

/** Run the grammar check on one SQL string; returns {accepts, stderr}. */
function check(sql: string): { accepts: boolean; output: string } {
  try {
    const out = execFileSync(PYTHON, [SCRIPT, "-"], { input: sql, encoding: "utf8" });
    return { accepts: out.startsWith("OK:"), output: out };
  } catch (e) {
    // Non-zero exit means the script flagged at least one failure (the SQL did
    // not parse). The stdout still contains the per-line result line.
    const out = e instanceof Error && "stdout" in e ? String((e as { stdout?: unknown }).stdout ?? "") : "";
    return { accepts: out.startsWith("OK:"), output: out };
  }
}

describe.skipIf(!VENV_READY)("grammar — positive queries", () => {
  it.each(POSITIVE_QUERIES)("parses: %s", (sql) => {
    const { accepts, output } = check(sql);
    expect(accepts, `expected to parse, got: ${output.trim()}`).toBe(true);
  });
});

describe.skipIf(!VENV_READY)("grammar — negative queries (security boundary)", () => {
  it.each(NEGATIVE_QUERIES)("rejects [$category]: $sql", ({ sql }) => {
    const { accepts, output } = check(sql);
    expect(accepts, `expected to reject, but grammar accepted it: ${output.trim()}`).toBe(false);
  });
});

describe.skipIf(VENV_READY)("grammar tests (skipped)", () => {
  it("is skipped — run `python3 -m venv .venv && .venv/bin/pip install lark` to enable", () => {
    expect(true).toBe(true);
  });
});
