import type { ReactNode } from "react";

/**
 * The standardized header for the left (history) and right (trace) sidebars.
 * Fixed at `h-12` to match the chat column's controls row, so all three
 * header bottom borders sit on one line across the screen. A `text-sm`
 * semibold title with an optional count pill, and a muted `text-xs` subtitle.
 * `action` slots a control (e.g. the clear-history button) on the right.
 */
export function SidebarHeader({
  title,
  subtitle,
  count,
  action,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold leading-tight">
          {title}
          {typeof count === "number" && count > 0 && (
            <span className="rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-secondary-foreground">
              {count}
            </span>
          )}
        </h2>
        {subtitle && (
          <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
