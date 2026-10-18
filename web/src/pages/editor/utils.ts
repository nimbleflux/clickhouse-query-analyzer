import type { QueryResult } from "@/api/types";
import { ApiError } from "@/api/errors";

export function splitQueries(sql: string): string[] {
  const stmts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  // Block comments nest in ClickHouse (/* /* */ */), so track depth rather
  // than a boolean — the first `*/` must not close an outer comment.
  let blockDepth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (blockDepth > 0) {
      if (ch === '/' && next === '*') {
        blockDepth++;
        current += "/*";
        i++;
      } else if (ch === '*' && next === '/') {
        blockDepth--;
        current += "*/";
        i++;
      } else {
        current += ch;
      }
      continue;
    }
    // Backslash escapes the next character inside quoted strings, so \' and
    // \" never close the literal ('a\'b;SELECT' stays one statement).
    if ((inSingle || inDouble) && ch === '\\' && i + 1 < sql.length) {
      current += ch + next;
      i++;
      continue;
    }
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      current += ch;
      if (inSingle && next === "'") {
        current += "'";
        i++;
      }
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += ch;
      if (inDouble && next === '"') {
        current += '"';
        i++;
      }
    } else if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
    } else if (ch === '/' && next === '*' && !inSingle && !inDouble && !inBacktick) {
      blockDepth++;
      current += "/*";
      i++;
    } else if (ch === '-' && !inSingle && !inDouble && !inBacktick && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += ' ';
    } else if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed) stmts.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }
  const trimmed = current.trim();
  if (trimmed) stmts.push(trimmed);
  return stmts;
}

/**
 * Strip leading SQL comments (`-- …` and `/* … *\/`) so statement
 * classification (destructive-statement detection) sees the real keyword.
 * Mirrors the backend's StripLeadingComments in
 * internal/clickhouse/execute.go: stacked comments are handled in a loop,
 * and an unterminated `/*` returns "" — such a query is a syntax error
 * anyway, and failing closed is the safe default.
 */
export function stripLeadingComments(query: string): string {
  let trimmed = query.trim();
  for (;;) {
    trimmed = trimmed.trim();
    if (trimmed.startsWith("--")) {
      const nl = trimmed.indexOf("\n");
      if (nl < 0) return "";
      trimmed = trimmed.slice(nl + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end < 0) return "";
      trimmed = trimmed.slice(end + 2);
      continue;
    }
    return trimmed;
  }
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = bytes;
  let u = -1;
  do { v /= 1024; u++; } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(1)} ${units[u]}`;
}

/** Render an error for display: message plus any actionable hint the backend attached. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    return e.hint ? `${e.message} — ${e.hint}` : e.message;
  }
  return e instanceof Error ? e.message : "Query failed";
}

/**
 * Quote one CSV/TSV cell (RFC-4180 style: wrap and double quotes when the
 * value contains the separator, a quote, or a newline) and neutralise
 * spreadsheet formula injection: a leading =, +, - or @ would execute as a
 * formula when the file opens in Excel/Sheets, so it gets a single-quote
 * prefix that forces text interpretation.
 */
export function escapeCell(val: unknown, sep: string): string {
  const s = val === null || val === undefined ? "" : String(val);
  let out = s.includes(sep) || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
  // Test the raw value: quoting hides a leading '=' behind '"', but the
  // spreadsheet still sees the formula once it strips the quotes.
  if (/^[=+\-@]/.test(s)) out = `'${out}`;
  return out;
}

export function exportResult(result: QueryResult, format: "csv" | "json" | "tsv") {
  let content: string;
  let mimeType: string;
  let ext: string;

  if (format === "json") {
    content = JSON.stringify(result.rows, null, 2);
    mimeType = "application/json";
    ext = "json";
  } else {
    const sep = format === "csv" ? "," : "\t";
    const header = result.columns.map((c) => escapeCell(c.name, sep)).join(sep);
    const rows = result.rows.map((row) =>
      result.columns.map((c) => escapeCell(row[c.name], sep)).join(sep)
    );
    content = [header, ...rows].join("\n");
    mimeType = format === "csv" ? "text/csv" : "text/tab-separated-values";
    ext = format;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `query-result.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? "⌘" : "Ctrl";
