/**
 * Local runbook — the offline counterpart to Raindrop's online signals.
 *
 * The cookbook's "Reporting" pillar: every full eval run appends a metrics
 * snapshot here so regressions show up across runs (model swap, prompt edit,
 * grammar change), not just within one run. Raindrop tracks live traffic; this
 * tracks the labelled offline set over time. Written under tests/runbook/
 * (gitignored — local analytics, commit if you want shared history).
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("./runbook/", import.meta.url));
const HISTORY = `${DIR}history.jsonl`;
const LATEST = `${DIR}latest.json`;

export interface RunbookEntry {
  /** ISO timestamp — passed in by the caller (tests run in Node, so Date is fine). */
  timestamp: string;
  gitSha: string;
  model: string;
  evalN: number;
  /** Constrained vs unconstrained, overall. */
  overall: {
    cfg: { parse: number; exec: number; correct: number };
    nocfg: { parse: number; exec: number; correct: number };
  };
  /** Constrained correctness (vs the live reference answer) by difficulty tier. */
  byTier: Record<string, { n: number; correct: number }>;
  /** Per-eval headline numbers. (Old history lines may carry the pre-rename
   *  `goldenPassRate` field — readers should tolerate both.) */
  perEval: {
    answerPassRate: number;
    schemaViolations: number;
  };
  /** THE headline: on the discriminating slice (adversarial + phantom-column —
   *  the prompts built to break the baseline), how many cases did each mode
   *  fail? The proof the saturated overall numbers can't show: baselineFailed
   *  should be most of n while cfgFailed stays 0. Absent on old history lines. */
  headline?: { n: number; baselineFailed: number; cfgFailed: number };
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Read the most recent prior entry, or null if there's no history yet. */
function readLastRunbookEntry(): RunbookEntry | null {
  try {
    const lines = readFileSync(HISTORY, "utf8").split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]) as RunbookEntry;
  } catch {
    return null;
  }
}

/**
 * Append `entry` (gitSha filled in here) to the runbook and overwrite latest.json.
 * Returns the previous entry so the caller can log deltas / regressions.
 */
export function writeRunbookEntry(entry: Omit<RunbookEntry, "gitSha">): { written: RunbookEntry; previous: RunbookEntry | null } {
  const previous = readLastRunbookEntry();
  const written: RunbookEntry = { ...entry, gitSha: gitSha() };
  mkdirSync(DIR, { recursive: true });
  appendFileSync(HISTORY, `${JSON.stringify(written)}\n`);
  writeFileSync(LATEST, `${JSON.stringify(written, null, 2)}\n`);
  return { written, previous };
}
