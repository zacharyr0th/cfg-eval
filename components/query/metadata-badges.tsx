"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { QueryResult } from "@/lib/query-types";

/**
 * A single quiet metrics line. Only the two numbers most people glance at —
 * execution time and total tokens — show inline; the model and generation time
 * (and the input/output token split) live in a hover tooltip so they're one
 * keystroke away without crowding every result. `cached`/`edited` stay inline
 * because they're state, not measurements, and change how to read the number.
 */
export function MetadataBadges({ result }: { result: QueryResult }) {
  const inline: React.ReactNode[] = [];

  if (result.cached)
    inline.push(
      <span key="cached" className="font-mono text-success-600 dark:text-success-300">
        cached
      </span>,
    );
  if (result.edited)
    inline.push(
      <span key="edited" className="font-mono text-warning-700 dark:text-warning-200">
        edited
      </span>,
    );
  if (typeof result.executionMs === "number")
    inline.push(
      <span key="exec" className="font-mono">
        {formatDuration(result.executionMs)}
      </span>,
    );
  if (result.usage)
    inline.push(
      <span key="tok" className="font-mono">
        {result.usage.totalTokens.toLocaleString()} tok
      </span>,
    );

  if (inline.length === 0) return null;

  // Everything detailed lives in the tooltip.
  const detail: string[] = [];
  if (result.model) detail.push(`Model ${result.model}`);
  if (typeof result.generationMs === "number") detail.push(`${formatDuration(result.generationMs)} to generate`);
  if (typeof result.executionMs === "number") detail.push(`${formatDuration(result.executionMs)} to run`);
  if (result.usage)
    detail.push(
      `${result.usage.totalTokens.toLocaleString()} tokens (${result.usage.inputTokens.toLocaleString()} in + ${result.usage.outputTokens.toLocaleString()} out)`,
    );

  const line = (
    <span className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground/80")}>
      {inline.map((item, i) => (
        <span key={i} className="flex items-center gap-x-1.5">
          {i > 0 && <span aria-hidden="true" className="text-muted-foreground/40">·</span>}
          {item}
        </span>
      ))}
    </span>
  );

  if (detail.length === 0) return line;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="cursor-default rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {line}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="block max-w-[16rem] leading-relaxed">{detail.join(" · ")}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
