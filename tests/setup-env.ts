import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Load `.env.local` (and `.env` as a fallback) into `process.env` for tests.
 *
 * Next.js does this automatically for `dev`/`build`, but Vitest doesn't —
 * without it, evals that need `OPENAI_API_KEY` or the `CLICKHOUSE_*` vars
 * would silently miss the configured values and fail at the first API call.
 * Doing this inline keeps it dependency-free (no `dotenv` install) and tiny.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function loadEnvFile(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return; // file doesn't exist; that's fine
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(`${root}/.env.local`);
loadEnvFile(`${root}/.env`);
