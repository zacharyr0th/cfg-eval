"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HistoryList } from "@/components/query/history-list";
import { SidebarHeader } from "@/components/query/sidebar-header";
import type { HistoryEntry } from "@/lib/use-query-history";

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onRunQuestion: (q: string) => void;
  onRunSql: (sql: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function HistoryPanel({ entries, onRunQuestion, onRunSql, onRemove, onClear }: HistoryPanelProps) {
  function select(entry: HistoryEntry) {
    if (entry.question) onRunQuestion(entry.question);
    else onRunSql(entry.sql);
  }

  return (
    <>
      <SidebarHeader
        title="History"
        count={entries.length}
        subtitle={
          entries.length === 0 ? "Your recent queries land here." : "Stored locally · click to rerun."
        }
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={entries.length === 0}
            onClick={onClear}
            title="Clear history"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            <span className="sr-only">Clear history</span>
          </Button>
        }
      />

      <HistoryList entries={entries} onSelect={select} onRemove={onRemove} />
    </>
  );
}
