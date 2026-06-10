/**
 * Decorative app backdrop: a warm field, an iridescent light-streak sweeping in
 * from the right, and a film-grain overlay. Purely decorative + non-interactive.
 * Fixed to the full viewport so it spans behind the (transparent-on-marketing)
 * header and footer too — the page and chrome read as one continuous surface,
 * no seam. Sits behind page content via each route's `isolate` + this layer's
 * -z-10. Theme-aware — the same layers read as warm cream in light mode and a
 * glowing bloom in dark mode. Shared by the landing, /evals, and /query routes
 * so the whole app sits on one cohesive surface.
 */
export function HeroBackdrop({ contentScrim = false }: { contentScrim?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Warm wash brightening the upper-right, where the light enters (theme-aware) */}
      <div className="hero-wash absolute -right-[10%] -top-[20%] h-[70rem] w-[70rem]" />

      {/* Warm tint behind the headline so the left field stays cream, not gray */}
      <div className="hero-tint absolute inset-0" />

      {/* Iridescent streak — anchored to the right half so content sits on the
          plain field; rotation on this static wrapper, the inner layer drifts.
          On mobile the streak rides further right so it doesn't bleed into the
          content at narrow widths. */}
      <div
        className="absolute left-[78%] right-[-18%] top-[2%] h-[86%] sm:left-[55%] sm:right-[-12%]"
        style={{ transform: "rotate(-13deg)" }}
      >
        <div
          className="animate-streak absolute inset-0"
          style={{
            background:
              "linear-gradient(148deg, rgba(134,224,175,0) 22%, rgba(134,224,175,0.55) 38%, rgba(126,188,236,0.6) 50%, rgba(168,162,234,0.58) 60%, rgba(238,168,198,0.52) 71%, rgba(244,198,173,0.35) 80%, rgba(244,198,173,0) 90%)",
            filter: "blur(58px)",
          }}
        />
        {/* Bright leading core of the comet — kept soft so it never blows out to
            near-white over text on the content-dense /query and /evals pages. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 34%, rgba(255,255,255,0.28) 54%, transparent 74%)",
            filter: "blur(30px)",
          }}
        />
      </div>

      {/* Film grain — soft-light for overall texture, multiply for darker dust specks */}
      <div className="noise-layer hero-grain absolute inset-0 mix-blend-soft-light" />
      <div className="noise-layer absolute inset-0 opacity-[0.09] mix-blend-multiply" />

      {/* Readability scrim for the content-dense app routes (/query, /evals): one
          full-viewport wash over the streak so the header and the body sit on a
          single continuous surface — not a separate scrim band per region. The
          marketing landing leaves this off so its hero rides the raw backdrop. */}
      {contentScrim && <div className="hero-content-scrim absolute inset-0" />}
    </div>
  );
}
