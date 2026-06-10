"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, Pencil, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { highlightSQL } from "@/lib/sql-highlight";
import type { QueryResult } from "@/lib/query-types";
import { MetadataBadges } from "@/components/query/metadata-badges";

interface SqlBlockProps {
  result: QueryResult;
  running: boolean;
  onRerun: (sql: string) => void;
}

export function SqlBlock({ result, running, onRerun }: SqlBlockProps) {
  // The parent remounts this block on each new result (keyed by SQL), so initial
  // state from `result.sql` is always fresh — no resync effect needed.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(result.sql);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context / permissions) — fail quietly.
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Generated SQL</p>
        <MetadataBadges result={result} />
      </div>

      {editing ? (
        <div className="rounded-xl border bg-card shadow-[var(--shadow-sm)] focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-ring">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            rows={Math.min(12, Math.max(3, draft.split("\n").length))}
            aria-label="Edit SQL"
            className="w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed focus-visible:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] text-warning-700 dark:text-warning-200">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span>
                Edited SQL runs <span className="font-medium">read-only</span> and bypasses the grammar
                guarantee.
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={running}>
                <X aria-hidden className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => onRerun(draft)} disabled={running || !draft.trim()}>
                <Play aria-hidden className="h-3.5 w-3.5" />
                Run SQL
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="group relative">
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7 bg-card/80 backdrop-blur-sm"
              aria-label="Edit SQL"
              title="Edit & re-run"
              onClick={() => {
                setDraft(result.sql);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7 bg-card/80 backdrop-blur-sm"
              aria-label={copied ? "Copied" : "Copy SQL"}
              title={copied ? "Copied!" : "Copy"}
              onClick={copy}
            >
              {copied ? (
                <Check aria-hidden className="h-3.5 w-3.5 text-success-600 dark:text-success-300" />
              ) : (
                <Copy aria-hidden className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap break-words rounded-xl border bg-card/90 p-3 pr-20 font-mono text-xs leading-relaxed shadow-[var(--shadow-sm)] backdrop-blur-md">
            <code>{highlightSQL(result.sql)}</code>
          </pre>
          {copied && (
            <span className="pointer-events-none absolute right-2 top-10 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
              Copied!
            </span>
          )}
        </div>
      )}
    </div>
  );
}
