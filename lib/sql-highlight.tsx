import type { ReactNode } from "react";

/**
 * Zero-dependency syntax highlighter for the SQL subset our Lark grammar emits.
 *
 * The accepted language is tiny and fully enumerated (see `lib/grammar/taxi.ts`),
 * so a single-pass tokenizer with a fixed keyword/function set is enough — no
 * need to pull in Prism/Shiki and a few hundred KB of generic grammars. Returns
 * an array of <span>s coloured with the existing theme tokens (primary for
 * keywords, info/success/warning for functions/strings/numbers) so it stays
 * legible in both light and dark mode without any new CSS.
 */

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT",
  "AS", "AND", "OR", "IN", "BETWEEN", "IS", "NOT", "NULL", "ASC", "DESC",
]);

const FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max", "uniq", "uniqExact",
  "toDate", "toHour", "toStartOfDay", "toStartOfHour", "toStartOfMonth",
  "toDayOfWeek", "toMonth", "toYear",
]);

// Ordered alternation: whitespace | string | number | word | punctuation |
// operator | any-other-char (so nothing is ever dropped).
const TOKEN_RE =
  /(\s+)|('(?:[^']|'')*')|(\d+\.?\d*|\.\d+)|([A-Za-z_]\w*)|([(),.])|([-+*/=<>!]+)|(.)/g;

export function highlightSQL(sql: string): ReactNode {
  const out: ReactNode[] = [];
  let key = 0;
  for (const m of sql.matchAll(TOKEN_RE)) {
    const [, ws, str, num, word, punct, op, other] = m;
    if (ws !== undefined) {
      out.push(ws);
    } else if (str !== undefined) {
      out.push(<span key={key++} className="text-success-700 dark:text-success-300">{str}</span>);
    } else if (num !== undefined) {
      out.push(<span key={key++} className="text-warning-700 dark:text-warning-300">{num}</span>);
    } else if (word !== undefined) {
      const cls = KEYWORDS.has(word.toUpperCase())
        ? "text-primary font-medium"
        : FUNCTIONS.has(word)
          ? "text-info-700 dark:text-info-300"
          : undefined;
      out.push(cls ? <span key={key++} className={cls}>{word}</span> : word);
    } else if (punct !== undefined) {
      out.push(<span key={key++} className="text-muted-foreground/70">{punct}</span>);
    } else if (op !== undefined) {
      out.push(<span key={key++} className="text-muted-foreground">{op}</span>);
    } else if (other !== undefined) {
      out.push(other);
    }
  }
  return out;
}
