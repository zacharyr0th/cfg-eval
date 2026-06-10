"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type TocItem = { id: string; label: string };

/** Sticky table of contents for the about page. Tracks the section currently
 *  under the header (scroll-spy) and smooth-scrolls on click. Desktop only —
 *  the page renders pill anchors inline on small screens instead. */
export function AboutToc({ items }: { items: readonly TocItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    // Active section = the last one whose top has crossed the line just
    // below the sticky header. Runs directly in the scroll handler — it's a
    // handful of getBoundingClientRect calls, and rAF throttling would stall
    // in backgrounded tabs.
    const update = () => {
      const offset = 120;
      let current = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= offset) current = section.id;
      }
      setActiveId(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-0.5 border-l border-border/60">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(item.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  history.replaceState(null, "", `#${item.id}`);
                  setActiveId(item.id);
                }}
                className={cn(
                  "-ml-px block border-l-2 py-1.5 pl-4 pr-2 text-[13px] leading-snug transition-colors",
                  active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
