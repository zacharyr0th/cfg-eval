"use client";

import { useCallback, useRef, useState } from "react";
import type { EvalRunError, EvalRunRequest, EvalTrialResult } from "@/lib/eval-run";

/**
 * Client orchestration for the in-app eval runner. The server runs ONE trial
 * per request (/api/evals); this hook turns "run the whole suite" into a
 * queue of those single-trial requests with:
 *
 *   - bounded concurrency (2 — kind to the OpenAI + ClickHouse budgets, and
 *     comfortably inside the route's rate limit),
 *   - one shared AbortController so Stop cancels in-flight fetches AND the
 *     pending queue in one move,
 *   - a 429 path that waits out `retryAfterMs` (holding its slot — if one
 *     trial is rate-limited, every other slot would be too) and retries,
 *   - per-trial history (`runs`), so re-running a case appends a fresh sample
 *     rather than overwriting — the pass@N spirit the scoreboard aggregates.
 *
 * All bookkeeping (queue, in-flight count, trial map) lives in refs and is
 * mirrored into React state via `commit` — state updaters here are plain
 * value setters, never effectful updater functions, so StrictMode's
 * double-invocation can't double-enqueue work.
 */

const EVAL_CONCURRENCY = 2;
const MAX_RATE_LIMIT_RETRIES = 2;

export type TrialStatus = "idle" | "queued" | "running" | "done" | "error";

export interface TrialState {
  status: TrialStatus;
  /** Every completed sample for this trial key, oldest first. */
  runs: EvalTrialResult[];
  /** Transport/HTTP failure message (the trial never ran). */
  error?: string;
}

export const IDLE: TrialState = { status: "idle", runs: [] };

/** Stable identity for one (suite, case, mode) slot in the UI. */
export function trialKey(spec: EvalRunRequest): string {
  return `${spec.suite}:${spec.id}:${spec.mode}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useEvalRunner() {
  const [state, setState] = useState<Record<string, TrialState>>({});
  const [pendingCount, setPendingCount] = useState(0);

  const stateRef = useRef(state);
  const pendingRef = useRef(0);
  const queueRef = useRef<EvalRunRequest[]>([]);
  const activeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  /** Synchronously update the trial map (ref first, then render state). */
  const commit = useCallback((next: Record<string, TrialState>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const patch = useCallback(
    (key: string, fn: (prev: TrialState) => TrialState) => {
      commit({ ...stateRef.current, [key]: fn(stateRef.current[key] ?? IDLE) });
    },
    [commit],
  );

  const setPending = useCallback((n: number) => {
    pendingRef.current = Math.max(0, n);
    setPendingCount(pendingRef.current);
  }, []);

  const runOne = useCallback(
    async (spec: EvalRunRequest, signal: AbortSignal) => {
      const key = trialKey(spec);
      const runsSoFar = (stateRef.current[key] ?? IDLE).runs.length;
      patch(key, (prev) => ({ ...prev, status: "running", error: undefined }));
      try {
        for (let attempt = 0; ; attempt++) {
          const res = await fetch("/api/evals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...spec, trial: runsSoFar }),
            signal,
          });
          if (res.ok) {
            const trial = (await res.json()) as EvalTrialResult;
            patch(key, (prev) => ({ status: "done", runs: [...prev.runs, trial] }));
            return;
          }
          const body = (await res.json().catch(() => null)) as EvalRunError | null;
          if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
            await sleep((body?.retryAfterMs ?? 5_000) + 250, signal);
            continue;
          }
          patch(key, (prev) => ({
            ...prev,
            status: "error",
            error: body?.error ?? `Request failed (${res.status})`,
          }));
          return;
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          patch(key, (prev) => ({ ...prev, status: "idle" }));
          return;
        }
        patch(key, (prev) => ({
          ...prev,
          status: "error",
          error: e instanceof Error ? e.message : "Network error",
        }));
      }
    },
    [patch],
  );

  const pump = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;
    while (activeRef.current < EVAL_CONCURRENCY && queueRef.current.length > 0) {
      const spec = queueRef.current.shift()!;
      activeRef.current += 1;
      void runOne(spec, controller.signal).finally(() => {
        activeRef.current -= 1;
        setPending(pendingRef.current - 1);
        pump();
      });
    }
  }, [runOne, setPending]);

  /** Queue trials (skipping any already queued/running) and start the pump. */
  const run = useCallback(
    (specs: EvalRunRequest[]) => {
      if (specs.length === 0) return;
      if (!abortRef.current) abortRef.current = new AbortController();

      const taken = new Set(queueRef.current.map(trialKey));
      const accepted: EvalRunRequest[] = [];
      for (const spec of specs) {
        const key = trialKey(spec);
        const status = (stateRef.current[key] ?? IDLE).status;
        if (taken.has(key) || status === "queued" || status === "running") continue;
        taken.add(key);
        accepted.push(spec);
      }
      if (accepted.length === 0) return;

      queueRef.current.push(...accepted);
      const next = { ...stateRef.current };
      for (const spec of accepted) {
        const key = trialKey(spec);
        next[key] = { ...(next[key] ?? IDLE), status: "queued", error: undefined };
      }
      commit(next);
      setPending(pendingRef.current + accepted.length);
      pump();
    },
    [commit, pump, setPending],
  );

  /** Abort in-flight requests and drop everything still queued. */
  const stop = useCallback(() => {
    const dropped = queueRef.current.splice(0, queueRef.current.length);
    abortRef.current?.abort();
    abortRef.current = null;
    const next = { ...stateRef.current };
    for (const spec of dropped) {
      const key = trialKey(spec);
      if (next[key]?.status === "queued") next[key] = { ...next[key], status: "idle" };
    }
    commit(next);
    setPending(pendingRef.current - dropped.length);
  }, [commit, setPending]);

  /** Stop and forget all collected runs. Callers wanting undo should snapshot
   *  the rendered `state` BEFORE calling. */
  const reset = useCallback(() => {
    stop();
    commit({});
  }, [stop, commit]);

  const restore = useCallback(
    (snapshot: Record<string, TrialState>) => {
      commit(snapshot);
    },
    [commit],
  );

  return { state, busy: pendingCount > 0, pendingCount, run, stop, reset, restore };
}
