import { useState } from "react";
import { Copy, Check, ExternalLink, Download, ArrowUp, ArrowDown, ChevronLeft, ChevronRightIcon, Loader2 } from "lucide-react";
import { formatNumber } from "@/utils";
import type { QueryResult } from "@/api/types";
import { exportResult, formatElapsed } from "./utils";

function CellValue({ val }: { val: unknown }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const display =
    val === null || val === undefined
      ? "NULL"
      : typeof val === "object"
        ? JSON.stringify(val)
        : String(val);

  const copy = () => {
    const text =
      val === null || val === undefined
        ? ""
        : typeof val === "object"
          ? JSON.stringify(val, null, 2)
          : String(val);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isNull = val === null || val === undefined;
  const isObj = typeof val === "object" && !isNull;

  return (
    <span className="group/cell relative inline-flex max-w-full items-center">
      <span
        onDoubleClick={() => setExpanded((e) => !e)}
        className={`${expanded ? "whitespace-pre-wrap break-all" : "truncate"} ${isNull ? "italic text-[var(--color-text-secondary)]" : isObj ? "text-[var(--color-accent)]" : ""}`}
        title={expanded ? undefined : (isObj ? JSON.stringify(val, null, 2) : display)}
      >
        {display}
      </span>
      <button
        onClick={copy}
        className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--surface-elevated)] group-hover/cell:opacity-100"
        title="Copy"
      >
        {copied ? (
          <Check className="h-3 w-3 text-[var(--color-success)]" />
        ) : (
          <Copy className="h-3 w-3 text-[var(--color-text-secondary)]" />
        )}
      </button>
    </span>
  );
}

interface ResultTableProps {
  result: QueryResult;
  pageSize: number;
  resultPage: number;
  pageLoading?: boolean;
  setResultPage: (fn: (p: number) => number) => void;
  onNavigate: (path: string) => void;
}

export function ResultTable({ result, pageSize, resultPage, pageLoading, setResultPage, onNavigate }: ResultTableProps) {
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState<string>("");
  const [sortAsc, setSortAsc] = useState(true);

  const filteredRows = result.rows.filter((row) => {
    for (const [col, filter] of Object.entries(colFilters)) {
      if (!filter) continue;
      const val = row[col];
      const str = val === null || val === undefined ? "null" : String(val).toLowerCase();
      if (!str.includes(filter.toLowerCase())) return false;
    }
    return true;
  });

  const sortedRows = sortCol
    ? [...filteredRows].sort((a, b) => {
        const va = a[sortCol];
        const vb = b[sortCol];
        let cmp = 0;
        if (va === null || va === undefined) cmp = vb === null || vb === undefined ? 0 : -1;
        else if (vb === null || vb === undefined) cmp = 1;
        else if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb));
        return sortAsc ? cmp : -cmp;
      })
    : filteredRows;

  // Rows received from the server are already the current page (no client-side slicing).
  const pageRows = sortedRows;
  const hasFilters = Object.values(colFilters).some((v) => v);

  // total_rows >= 0 means the server computed a real total. -1 means unknown
  // (e.g. non-SELECT query or count failed). In the unknown case, if we
  // received a full page we assume there may be more.
  const totalKnown = result.total_rows >= 0;
  const totalRows = totalKnown ? result.total_rows : -1;
  const hasMore = totalKnown
    ? (resultPage + 1) * pageSize < totalRows
    : result.rows.length >= pageSize;
  const showPagination = resultPage > 0 || hasMore || totalKnown;

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      if (sortAsc) { setSortAsc(false); }
      else { setSortCol(""); setSortAsc(true); }
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  return (
    <div>
      {result.query_id && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate(`/query/${result.query_id}`)}
            className="flex items-center gap-1 rounded border border-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--surface-elevated)]"
          >
            <ExternalLink className="h-3 w-3" />
            View Analysis
          </button>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
            {result.query_id}
            <button
              onClick={() => { navigator.clipboard.writeText(result.query_id); }}
              className="rounded p-0.5 hover:bg-[var(--surface-elevated)]"
              title="Copy Query ID"
            >
              <Copy className="h-3 w-3" />
            </button>
          </span>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {totalKnown
              ? `${formatNumber(totalRows)} rows in ${formatElapsed(result.timing_ms)}`
              : `${formatNumber(result.row_count)} row${result.row_count !== 1 ? "s" : ""} in ${formatElapsed(result.timing_ms)}`}
          </span>
          {hasFilters && (
            <button
              onClick={() => setColFilters({})}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              Clear filters
            </button>
          )}
          {result.rows.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => exportResult(result, "csv")}
                className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                title="Export as CSV"
              >
                <Download className="h-3 w-3" />CSV
              </button>
              <button
                onClick={() => exportResult(result, "json")}
                className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                title="Export as JSON"
              >
                <Download className="h-3 w-3" />JSON
              </button>
              <button
                onClick={() => exportResult(result, "tsv")}
                className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                title="Export as TSV"
              >
                <Download className="h-3 w-3" />TSV
              </button>
            </div>
          )}
        </div>
      )}
      {result.columns.length > 0 ? (
        <>
          <div className="overflow-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  {result.columns.map((c) => (
                    <th
                      key={c.name}
                      onClick={() => toggleSort(c.name)}
                      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] whitespace-nowrap hover:text-[var(--color-text-primary)]"
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.name}
                        {sortCol === c.name && (
                          sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        )}
                      </span>
                      <div className="text-[9px] font-normal opacity-60">{c.type}</div>
                    </th>
                  ))}
                </tr>
                {result.rows.length > 1 && (
                  <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                    {result.columns.map((c) => (
                      <th key={c.name} className="px-1 py-1">
                        <input
                          type="text"
                          value={colFilters[c.name] || ""}
                          onChange={(e) => {
                            setColFilters((prev) => ({ ...prev, [c.name]: e.target.value }));
                          }}
                          placeholder="Filter..."
                          className="w-full min-w-[60px] rounded border border-[var(--color-border)] bg-[var(--surface-base)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]">
                    {result.columns.map((c) => (
                      <td key={c.name} className="max-w-sm px-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                        <CellValue val={row[c.name]} />
                      </td>
                    ))}
                  </tr>
                ))}
                {sortedRows.length === 0 && hasFilters && (
                  <tr>
                    <td colSpan={result.columns.length} className="px-4 py-4 text-center text-xs text-[var(--color-text-secondary)]">
                      No rows match filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {showPagination && (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs text-[var(--color-text-secondary)]">
              <span>
                {resultPage * pageSize + 1}-{totalKnown ? Math.min((resultPage + 1) * pageSize, totalRows) : resultPage * pageSize + result.rows.length}
                {totalKnown ? ` of ${formatNumber(totalRows)}` : ""}
              </span>
              {pageLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              <button
                onClick={() => setResultPage((p) => Math.max(0, p - 1))}
                disabled={resultPage === 0 || pageLoading}
                className="rounded p-1 hover:bg-[var(--surface-elevated)] disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setResultPage((p) => p + 1)}
                disabled={!hasMore || pageLoading}
                className="rounded p-1 hover:bg-[var(--surface-elevated)] disabled:opacity-30"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-[var(--color-text-secondary)]">Query executed successfully. No results returned.</div>
      )}
    </div>
  );
}
