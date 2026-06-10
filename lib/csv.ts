/**
 * Minimal RFC-4180 CSV serialization + a browser download helper.
 *
 * We export the *raw* cell values (not the grouped display strings) so the file
 * round-trips cleanly into a spreadsheet or another query tool.
 */

/** A value a spreadsheet would round-trip as a number, not interpret as text. */
function isNumeric(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Formula-injection guard: a cell beginning with = + - @ (or a control char)
  // is executed as a formula by Excel/Sheets on open. Prefix a tab so it's read
  // as text instead. Skip genuine numbers — a negative fare like "-5.5" is data,
  // not a formula, and must round-trip back into a query tool unchanged.
  if (/^[=+\-@\t\r]/.test(s) && !isNumeric(s)) s = `\t${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCSV(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const header = columns.map(escapeField).join(",");
  const body = rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
  return body ? `${header}\r\n${body}` : header;
}

/** Trigger a client-side download of `content` as `filename`. No-op on the server. */
export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
