import "server-only";

/**
 * Minimal in-process fixed-window rate limiter.
 *
 * Both /api/query and /api/execute are open (no auth): /api/query spends OpenAI
 * tokens on every cache-miss, /api/execute runs arbitrary SELECTs against the
 * cluster. A trivial loop can drain the API budget or hammer ClickHouse, so each
 * route is gated to a bounded number of requests per window per caller.
 *
 * Per process (resets on restart) and per server instance — on a multi-instance
 * or serverless deploy each instance keeps its own counters, so this is a
 * best-effort abuse brake, not a global quota. For a hard global limit, back it
 * with a shared store (Redis/Upstash) keyed the same way. The window map is
 * pruned lazily so it can't grow without bound.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Milliseconds until the window resets — surfaced as Retry-After. */
  retryAfterMs: number;
}

/**
 * Record a hit for `key` and report whether it's within `limit` per `windowMs`.
 * `now` is injectable for tests; defaults to wall-clock.
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const { limit, windowMs } = opts;
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    // Opportunistic prune: clear expired windows once the map gets large so a
    // churn of distinct keys (spoofed IPs) can't grow it without limit.
    if (windows.size > MAX_KEYS) {
      for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

/** Test-only: drop all counters. */
export function __resetRateLimits(): void {
  windows.clear();
}
