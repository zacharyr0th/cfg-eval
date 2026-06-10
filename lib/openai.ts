import "server-only";
import OpenAI from "openai";

/**
 * OpenAI client + model selection.
 *
 * Default model: `gpt-5`. The Context-Free Grammar feature is GPT-5-only; all
 * three tiers (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`) support it. Override with
 * `OPENAI_MODEL` to swap tiers — the eval suite runs across all three to show
 * the cost / accuracy tradeoff.
 *
 * The SDK reads `OPENAI_API_KEY` from `process.env` automatically when the
 * client is constructed with no `apiKey` argument.
 *
 * Rate-limit handling (per OpenAI's "How to handle rate limits" cookbook):
 *   - `maxRetries` is bumped from the SDK default of 2 to 6. The SDK already
 *     implements exponential backoff with jitter on 429 / 5xx natively — the
 *     knob to turn for the cookbook's "retry with exponential backoff"
 *     recipe is just the number of attempts. 6 matches the cookbook's
 *     reference examples (`stop_after_attempt(6)`, `max_tries=6`).
 *   - `timeout` is set to 120s. Reasoning + tool-format requests routinely
 *     run 30-60s; the SDK default (10 min) is so loose that a hung request
 *     blocks the eval loop for too long before retry kicks in.
 */

export const MODEL_ID = process.env.OPENAI_MODEL?.trim() || "gpt-5";

/**
 * Reasoning effort for the GPT-5 calls. NL→SQL here is grammar-constrained — the
 * CFG already guarantees a syntactically valid query — so the model does not need
 * to "reason" about whether its output parses. `minimal` is the optimized default,
 * and it's eval-validated: across the full case set at N=2 it held a 1.0 correct
 * rate (24/24 constrained trials) while cutting avg generation latency ~43% vs
 * `low` (1656ms vs 2925ms) — and far below the `medium` API default. Bump to
 * `low`/`medium` for a conservative margin on harder/unseen prompts, or `high`
 * for maximum reasoning. Env: `OPENAI_REASONING_EFFORT`.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export const REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT?.trim() ||
  "minimal") as ReasoningEffort;

/**
 * Output verbosity. We want a single bare SQL statement, never prose, so `low`
 * is the optimized default. Env: `OPENAI_TEXT_VERBOSITY`.
 */
export type TextVerbosity = "low" | "medium" | "high";
export const TEXT_VERBOSITY = (process.env.OPENAI_TEXT_VERBOSITY?.trim() ||
  "low") as TextVerbosity;

/**
 * Hard cap on output tokens (reasoning + emitted SQL combined). A single SELECT
 * plus low-effort reasoning is far under this; it's a backstop against a runaway
 * generation, not a normal-path limit. Env: `OPENAI_MAX_OUTPUT_TOKENS`.
 */
export const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? "4096");

export const openai = new OpenAI({
  maxRetries: 6,
  timeout: 120_000,
});

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
