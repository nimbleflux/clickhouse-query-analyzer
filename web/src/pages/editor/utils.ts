import type { QueryResult } from "@/api/types";

export function splitQueries(sql: string): string[] {
  const stmts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      current += ch;
      if (inSingle && i + 1 < sql.length && sql[i + 1] === "'") {
        current += "'";
        i++;
      }
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += ch;
      if (inDouble && i + 1 < sql.length && sql[i + 1] === '"') {
        current += '"';
        i++;
      }
    } else if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
    } else if (ch === '-' && !inSingle && !inDouble && !inBacktick && i + 1 < sql.length && sql[i + 1] === '-') {
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

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
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
    const escape = (val: unknown) => {
      const s = val === null || val === undefined ? "" : String(val);
      return s.includes(sep) || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };
    const header = result.columns.map((c) => escape(c.name)).join(sep);
    const rows = result.rows.map((row) =>
      result.columns.map((c) => escape(row[c.name])).join(sep)
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
