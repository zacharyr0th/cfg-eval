"use client";

import { useState } from "react";
import { History, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { HistoryList } from "@/components/query/history-list";
import type { HistoryEntry } from "@/lib/use-query-history";

interface HistorySheetProps {
  entries: HistoryEntry[];
  onRunQuestion: (q: string) => void;
  onRunSql: (sql: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function HistorySheet({ entries, onRunQuestion, onRunSql, onRemove, onClear }: HistorySheetProps) {
  const [open, setOpen] = useState(false);

  function select(entry: HistoryEntry) {
    setOpen(false);
    if (entry.question) onRunQuestion(entry.question);
    else onRunSql(entry.sql);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
          <History aria-hidden className="h-3.5 w-3.5" />
          History
          {entries.length > 0 && (
            <>
              <span
                aria-hidden="true"
                className="ml-0.5 rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-secondary-foreground"
              >
                {entries.length}
              </span>
              <span className="sr-only">
                , {entries.length} saved {entries.length === 1 ? "query" : "queries"}
              </span>
            </>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b p-5 text-left">
          <SheetTitle>Query history</SheetTitle>
          <SheetDescription>
            Your last {entries.length === 1 ? "query" : `${entries.length || ""} queries`}, stored locally in this
            browser. Click one to run it again.
          </SheetDescription>
        </SheetHeader>

        <HistoryList entries={entries} onSelect={select} onRemove={onRemove} />

        <div className="flex items-center justify-between border-t p-3">
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="sm">
              Close
            </Button>
          </SheetClose>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={entries.length === 0}
            onClick={onClear}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Clear all
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
