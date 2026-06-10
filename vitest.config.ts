import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the `@/*` path alias (matches tsconfig.json) so tests can import app modules.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // `server-only`'s default export throws; in tests we run server modules
      // directly in Node, so swap it for the package's own no-op entry. The
      // package doesn't expose `empty.js` via its `exports` field, so we point
      // at the file directly via the resolved node_modules path.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    // The first eval-suite test triggers the shared loader (loadOrRun in
    // tests/evals.test.ts), which runs every case in both modes for N trials —
    // sequential, GPT-5 + ClickHouse. With 12 cases * N=2 trials * 2 modes
    // and ~6s/call, the first test takes ~5 min. 10 min headroom covers
    // retries and the occasional slow CFG decode.
    testTimeout: 600_000,
    setupFiles: ["./tests/setup-env.ts"],
    // The eval suites REPORT through console.table (head-to-head, HEADLINE,
    // runbook deltas). Vitest's console intercept hides those in a plain
    // `bun run test`, which silently defeats the reporting — print directly.
    disableConsoleIntercept: true,
  },
});
