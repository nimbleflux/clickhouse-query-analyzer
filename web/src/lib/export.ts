/**
 * Client-side table export. Builds the file in memory and triggers a download
 * via a temporary <a download> — no backend round-trip, exports exactly the
 * rows/columns the user sees on the current page.
 */

export type ExportFormat = "csv" | "json";

/**
 * Escape a single CSV cell:
 *  - Quote cells containing the separator, quotes, or newlines ("" doubles a quote).
 *  - Prefix values starting with =, +, -, @ with a single quote so spreadsheet
 *    apps treat them as text instead of formulas (CSV injection guard).
 */
function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Download a table as CSV or JSON.
 *
 * CSV: one header row (the columns), then one row per entry; cells escaped as
 * described above. JSON: an array of objects keyed by the column names, so
 * consumers get named fields instead of positional arrays.
 */
export function downloadTable(
  filename: string,
  columns: string[],
  rows: (string | number | null)[][],
  format: ExportFormat,
): void {
  let content: string;
  if (format === "json") {
    content = JSON.stringify(
      rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null]))),
      null,
      2,
    );
  } else {
    content = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }

  const blob = new Blob([content], {
    type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
