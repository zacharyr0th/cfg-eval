import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroBackdrop } from "@/components/hero-backdrop";
import { DATASET } from "@/lib/schema";

/** ClickHouse's public NYC Taxi sample — the dataset every query and eval runs against. */
const DATASET_URL = "https://clickhouse.com/docs/getting-started/example-datasets/nyc-taxi";

export default function HomePage() {
  return (
    <section className="relative isolate flex flex-1 flex-col overflow-hidden">
      <HeroBackdrop />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 pb-8 pt-6 sm:px-6 sm:pb-10 sm:pt-8 md:px-10 md:pt-12">
        {/* Hero */}
        <div className="flex flex-1 flex-col justify-center py-10 sm:py-14 md:py-16">
          <h1 className="max-w-4xl text-[2.25rem] font-medium leading-[1.05] tracking-[-0.03em] text-foreground sm:text-6xl sm:leading-[1.03] lg:text-7xl">
            <span className="block md:inline">Does constraining the decoder</span>{" "}
            <span className="block md:inline">actually help?</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-foreground/80 sm:mt-7 sm:text-lg md:text-xl">
            A head-to-head eval: GPT-5 with grammar-constrained decoding vs. without, on real ClickHouse.
          </p>
          <p className="mt-5 max-w-2xl text-sm leading-loose text-muted-foreground sm:text-base">
            Every query runs against the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
              {DATASET.table}
            </code>{" "}
            table from ClickHouse&rsquo;s public{" "}
            <a
              href={DATASET_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              NYC Taxi dataset
              <ExternalLink aria-hidden className="h-3 w-3" />
            </a>{" "}
            — {DATASET.rowCount}, {DATASET.rangeStart} to {DATASET.rangeEnd}.
          </p>

          <div className="mt-10 flex flex-col items-stretch gap-3 sm:mt-11 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              asChild
              size="lg"
              className="w-full bg-foreground text-background shadow-[var(--shadow-md)] hover:bg-foreground/90 sm:w-auto"
            >
              <Link href="/query">
                Try a query
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="w-full text-foreground sm:w-auto">
              <Link href="/evals">
                View evals
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
