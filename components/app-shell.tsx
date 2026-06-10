"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The outer page frame. Most routes grow with their content (`min-h-dvh`) and
 * scroll the document normally. The /query and /evals routes are single-screen
 * apps: the shell is locked to the viewport (`h-dvh` + `overflow-hidden`) so
 * the header and footer stay pinned and the transcript / eval list scrolls
 * *inside* the frame instead of the whole document scrolling past the footer.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const locked = pathname?.startsWith("/query") || pathname?.startsWith("/evals");
  return (
    <div className={cn("flex flex-col", locked ? "h-dvh overflow-hidden" : "min-h-dvh")}>
      {children}
    </div>
  );
}
