"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, formatTimestamp, humanizeDatesInText } from "@/lib/format";
import { useNowTick, type HistoryEntry } from "@/lib/use-query-history";

interface HistoryListProps {
  entries: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
}

/** The scrollable history entries list, shared by the sidebar panel and the mobile sheet. */
export function HistoryList({ entries, onSelect, onRemove }: HistoryListProps) {
  const now = useNowTick();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {entries.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">
          No history yet. Run a query and it&rsquo;ll show up here.
        </p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(e)}
                className="w-full rounded-lg border border-transparent px-3 py-2.5 pr-9 text-left transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {e.question ? humanizeDatesInText(e.question) : "Edited SQL"}
                  </span>
                  {e.edited && <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[10px]">edited</Badge>}
                  {e.outOfScope && <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[10px]">out of scope</Badge>}
                  {e.error && <Badge variant="danger" className="shrink-0 px-1.5 py-0 text-[10px]">failed</Badge>}
                  {e.cached && <Badge variant="success" className="shrink-0 px-1.5 py-0 text-[10px]">cached</Badge>}
                </div>
                {e.sql ? (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{e.sql}</p>
                ) : e.outOfScope ? (
                  <p className="mt-1 truncate text-[11px] italic text-muted-foreground">
                    Declined — no SQL was run.
                  </p>
                ) : null}
                {e.error && (
                  <p className="mt-1 truncate text-[11px] text-destructive/80">{e.error}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {typeof e.rowCount === "number" && typeof e.executionMs === "number" && (
                    <>
                      <span className="tabular-nums">{e.rowCount.toLocaleString()}</span> row{e.rowCount === 1 ? "" : "s"}
                      <span className="mx-1.5">·</span>
                      <span className="tabular-nums">{e.executionMs} ms</span>
                      <span className="mx-1.5">·</span>
                    </>
                  )}
                  {typeof e.totalTokens === "number" && (
                    <>
                      <span className="tabular-nums">{e.totalTokens.toLocaleString()} tok</span>
                      <span className="mx-1.5">·</span>
                    </>
                  )}
                  <span title={formatTimestamp(e.ts)}>{formatRelativeTime(e.ts, now)}</span>
                </p>
              </button>
              <button
                type="button"
                onClick={() => onRemove(e.id)}
                aria-label="Remove from history"
                className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
