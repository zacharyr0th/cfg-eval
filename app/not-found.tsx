import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-5 py-20 sm:px-6 md:px-10">
      <p className="font-mono text-sm font-medium tracking-widest text-muted-foreground">404</p>
      <h1 className="mt-4 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-sm text-center text-base text-muted-foreground">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has been moved.
      </p>
      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <Button
          asChild
          size="lg"
          className="w-full bg-foreground text-background shadow-[var(--shadow-md)] hover:bg-foreground/90 sm:w-auto"
        >
          <Link href="/">
            Go home
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="ghost" className="w-full text-foreground sm:w-auto">
          <Link href="/query">Try a query</Link>
        </Button>
      </div>
    </div>
  );
}
