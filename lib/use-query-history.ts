"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Last-N query history persisted to localStorage. Survives reloads so /query
 * behaves like a tool you return to, not a one-shot demo. Hydrated after mount
 * to avoid an SSR/client markup mismatch.
 */

export interface HistoryEntry {
  id: string;
  /** The NL prompt, or "" for an edited-SQL run. */
  question: string;
  /** Generated/edited SQL, or "" when none was produced (refusal, early failure). */
  sql: string;
  /** Absent when no query ran (refusal / failure). */
  rowCount?: number;
  generationMs?: number;
  /** Absent when no query ran (refusal / failure). */
  executionMs?: number;
  totalTokens?: number;
  cached?: boolean;
  edited?: boolean;
  /** The model declined via cannot_answer — recorded so the chat and panel agree. */
  outOfScope?: boolean;
  /** Terminal failure message, when the turn errored instead of returning rows. */
  error?: string;
  /** Machine tag for the failure, e.g. `generation_failed`, `rate_limited`, `network`. */
  errorKind?: string;
  ts: number;
}

const STORAGE_KEY = "cfgsql.history.v1";
const MAX_ENTRIES = 100;

function load(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private mode / quota — history is best-effort, so swallow.
  }
}

/**
 * A "now" that re-renders every minute, so relative timestamps ("5 min ago")
 * in the history panels stay current instead of freezing at their first paint.
 */
export function useNowTick(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useQueryHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    // One-time hydration from localStorage after mount. Reading it in the render
    // path (a lazy useState initializer) would mismatch the server's empty render
    // and warn on hydration, so we sync exactly once here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(load());
  }, []);

  const add = useCallback((entry: Omit<HistoryEntry, "id" | "ts">) => {
    setEntries((prev) => {
      const next: HistoryEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
      };
      // Drop a prior identical run so repeats bubble to the top instead of piling up.
      const deduped = prev.filter((p) => !(p.sql === entry.sql && p.question === entry.question));
      const updated = [next, ...deduped].slice(0, MAX_ENTRIES);
      save(updated);
      return updated;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      save(updated);
      return updated;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    save([]);
  }, []);

  return { entries, add, remove, clear };
}
