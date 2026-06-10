import { cn } from "@/lib/utils";

/**
 * The CFG Eval brand mark: a gradient tile holding a checkmark —
 * "a constrained query that always passes". Self-contained inline SVG so it
 * stays crisp at any size and themes with the violet brand ramp.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      className={cn("h-7 w-7", className)}
    >
      <defs>
        <linearGradient id="cfg-logo-grad" x1="6" y1="2" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="hsl(252 64% 70%)" />
          <stop offset="1" stopColor="hsl(256 44% 46%)" />
        </linearGradient>
        <radialGradient id="cfg-logo-shine" cx="0.36" cy="0.34" r="0.5">
          <stop offset="0" stopColor="white" stopOpacity="0.55" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Rounded tile */}
      <rect x="3.5" y="3.5" width="25" height="25" rx="8" fill="url(#cfg-logo-grad)" />
      {/* Soft top-left highlight for a glassy read */}
      <rect x="3.5" y="3.5" width="25" height="25" rx="8" fill="url(#cfg-logo-shine)" />
      {/* Rim light */}
      <rect
        x="3.5"
        y="3.5"
        width="25"
        height="25"
        rx="8"
        fill="none"
        stroke="white"
        strokeOpacity="0.22"
        strokeWidth="0.8"
      />

      {/* Eval checkmark — the query passed */}
      <path
        d="M11 16.4 14.6 20 21.4 12.8"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
