"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";

const links = [
  { href: "/query", label: "Query" },
  { href: "/evals", label: "Evals" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const pathname = usePathname();
  // The header carries the same translucent overlay as the /query and /evals
  // sidebars (bg-background/40 + backdrop-blur over the shared hero backdrop),
  // so all three chrome regions read as one frosted frame around the content.
  // /query and /evals are full-bleed single-screen apps — their headers span
  // edge to edge to line up with the full-width columns below, rather than
  // centering on a max-w-7xl track like the content routes.
  const isFullBleed = pathname?.startsWith("/query") || pathname?.startsWith("/evals");

  return (
    <header className="safe-area-inset-top sticky top-0 z-40 border-b border-border/50 bg-background/40 backdrop-blur-sm">
      <div
        className={cn(
          "grid h-16 grid-cols-[1fr_auto_1fr] items-center px-4 md:px-6",
          isFullBleed ? "w-full" : "mx-auto max-w-7xl",
        )}
      >
        {/* Left — brand */}
        <div className="flex items-center">
          <Link
            href="/"
            aria-label="CFG Eval — home"
            className="group flex items-center gap-2.5 rounded-xl py-1 pr-2 transition-opacity hover:opacity-90"
          >
            <span className="grid place-items-center rounded-xl bg-gradient-to-b from-primary/15 to-transparent p-1 ring-1 ring-border/50 shadow-[var(--shadow-sm)]">
              <Logo className="h-6 w-6" />
            </span>
            <span className="hidden text-[15px] font-semibold leading-none tracking-tight sm:inline">
              CFG{" "}
              <span
                title="CFG = context-free grammar — SQL decoding constrained at every token"
                className="font-medium text-muted-foreground"
              >
                Eval
              </span>
            </span>
          </Link>
        </div>

        {/* Center — primary nav, a soft segmented control */}
        <nav className="flex items-center gap-0.5 rounded-full border border-border/50 bg-background/50 p-1 backdrop-blur-sm">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[36px] items-center rounded-full px-4 text-sm font-medium transition-colors",
                  active
                    ? "bg-foreground text-background shadow-[var(--shadow-sm)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        {/* Right — actions */}
        <div className="flex items-center justify-end gap-2">
          <ThemeToggle />
          {!isFullBleed && (
            <Button
              asChild
              size="sm"
              className="hidden bg-foreground text-background hover:bg-foreground/90 sm:inline-flex"
            >
              <Link href="/query">Get started</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
