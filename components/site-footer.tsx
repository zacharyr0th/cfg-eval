"use client";

import { usePathname } from "next/navigation";
import { Github } from "lucide-react";

const BUILT_ON = ["GPT-5", "Context-Free Grammar", "ClickHouse", "Lark"];

export function SiteFooter() {
  const pathname = usePathname();
  // The footer only appears on the landing page. The landing sits on the hero
  // backdrop (it spans the full viewport, incl. behind the footer), so the
  // footer goes transparent to read as one continuous surface with it.
  if (pathname !== "/") return null;

  return (
    <footer className="safe-area-inset bg-transparent">
      <div className="mx-auto flex max-w-7xl flex-row flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 md:px-6">
        {/* Built on */}
        <div className="hidden flex-wrap items-center gap-x-4 gap-y-1.5 md:flex">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            Built on
          </span>
          {BUILT_ON.map((name) => (
            <span
              key={name}
              className="text-xs font-medium tracking-tight text-foreground/55 transition-colors hover:text-foreground/85"
            >
              {name}
            </span>
          ))}
        </div>

        {/* Built by */}
        <a
          href="https://github.com/zacharyr0th"
          target="_blank"
          rel="noopener noreferrer"
          className="group ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Github aria-hidden="true" className="h-3.5 w-3.5" />
          <span>Built by</span>
          <span className="font-medium text-foreground/80 transition-colors group-hover:text-foreground">
            zacharyr0th
          </span>
        </a>
      </div>
    </footer>
  );
}
