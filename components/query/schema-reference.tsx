"use client";

import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DATASET, PAYMENT_TYPES, SCHEMA_COLUMNS, SCHEMA_NOTE } from "@/lib/schema";

/**
 * The dataset's "what can I query" reference, surfaced from the header as a
 * dialog instead of a permanent sidebar panel — the schema is reference
 * material people reach for occasionally, not something that needs to sit on
 * screen competing with the conversation.
 */
export function SchemaReference() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="What can I query?">
          <Database aria-hidden className="mr-1 h-3.5 w-3.5" />
          Schema
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="space-y-2 border-b border-border/60 px-6 py-5">
          <DialogTitle className="text-base font-medium">What can I query?</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {DATASET.table}
            </code>
            <span className="text-muted-foreground/50">·</span>
            <span>{DATASET.rowCount}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {DATASET.rangeStart} → {DATASET.rangeEnd}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-x-8 px-6 py-5 sm:grid-cols-2">
          {SCHEMA_COLUMNS.map((col) => (
            <div
              key={col.name}
              className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 last:border-0"
            >
              <code className="font-mono text-xs text-foreground">{col.name}</code>
              <span className="text-right text-[11px] text-muted-foreground">
                {col.type}
                {col.note ? ` · ${col.note}` : ""}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border/60 px-6 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wider text-muted-foreground/70">
              payment_type
            </span>
            {PAYMENT_TYPES.map((p) => (
              <span key={p.code} className="whitespace-nowrap">
                <code className="font-mono text-foreground">{p.code}</code> {p.label}
              </span>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">{SCHEMA_NOTE}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
