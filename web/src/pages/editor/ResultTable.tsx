import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, Check, ExternalLink, Download, ArrowUp, ArrowDown, ChevronLeft, ChevronRightIcon, Loader2, TriangleAlert, Table2, LineChart as LineChartIcon } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatNumber } from "@/utils";
import type { QueryResult } from "@/api/types";
import { countQueryRows } from "@/api/client";
import { isNumericType, defaultXColumn, buildChartPoints } from "@/lib/chartData";
import { exportResult, formatElapsed, errorText } from "./utils";

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
        className={`${expanded ? "block max-h-[300px] overflow-auto whitespace-pre" : "truncate"} ${isNull ? "italic text-[var(--color-text-secondary)]" : isObj ? "text-[var(--color-accent)]" : ""}`}
        title={expanded ? undefined : (isObj ? JSON.stringify(val, null, 2) : display)}
      >
        {display}
      </span>
      <button
        onClick={copy}
        className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--surface-elevated)] group-hover/cell:opacity-100 focus-visible:opacity-100"
        aria-label={copied ? "Copied" : "Copy cell value"}
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
  /**
   * The original statement this result came from. When present, the header
   * offers an explicit "count all rows" action — total counts are no longer
   * computed automatically (that silently doubled the cost of heavy queries).
   */
  statement?: string;
  /** Advisor quick-action handler ("add_limit", "set_max_execution_time"). */
  onSuggestion?: (action: string) => void;
}

// Token-backed series palette for multiple Y columns (theme-aware order:
// accent first, then the semantic hues).
const SERIES_COLORS = [
  "var(--color-accent)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-error)",
  "var(--color-text-secondary)",
];

/**
 * Chart rendering of the result: X axis picker, multi-select Y columns,
 * one Line per selected column. Mounted with a key derived from the result
 * identity, so axis selections reset when a new result arrives and each
 * statement's result in a multi-statement run keeps its own state.
 */
function ChartView({ result }: { result: QueryResult }) {
  const numericCols = useMemo(
    () => result.columns.filter((c) => isNumericType(c.type)).map((c) => c.name),
    [result.columns],
  );
  const [xCol, setXCol] = useState(() => defaultXColumn(result.columns));
  const [yCols, setYCols] = useState<string[]>(() => numericCols.slice(0, 1));

  const { points, truncated } = useMemo(
    () => buildChartPoints(result.rows, xCol, yCols),
    [result.rows, xCol, yCols],
  );
  // recharts wants flat records: { x, [yCol]: number | undefined }.
  const data = useMemo(
    () => points.map((p) => ({ x: p.x, ...p.values })),
    [points],
  );

  const toggleY = (col: string) => {
    setYCols((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
          X axis:
          <select
            value={xCol}
            onChange={(e) => setXCol(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-xs text-[var(--color-text-primary)]"
          >
            {!defaultXColumn(result.columns) && result.columns.every((c) => isNumericType(c.type)) && (
              <option value="">(row #)</option>
            )}
            {result.columns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-text-secondary)]">Y:</span>
          {numericCols.map((col) => (
            <label key={col} className="flex cursor-pointer items-center gap-1 text-xs text-[var(--color-text-primary)]">
              <input
                type="checkbox"
                checked={yCols.includes(col)}
                onChange={() => toggleY(col)}
                className="accent-[var(--color-accent)]"
              />
              {col}
            </label>
          ))}
        </div>
        {truncated && (
          <span className="text-xs text-[var(--color-text-secondary)]" title="Charts plot at most the first 1000 rows">
            Showing first 1000 rows
          </span>
        )}
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis dataKey="x" tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} minTickGap={32} />
            <YAxis tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} width={64} />
            <Tooltip
              contentStyle={{
                background: "var(--surface-card)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--color-text-primary)",
              }}
              labelStyle={{ color: "var(--color-text-secondary)" }}
              isAnimationActive={false}
            />
            {yCols.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-text-secondary)" }} />
            )}
            {yCols.map((col, i) => (
              <Line
                key={col}
                type="monotone"
                dataKey={col}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ResultTable({ result, pageSize, resultPage, pageLoading, setResultPage, onNavigate, statement, onSuggestion }: ResultTableProps) {
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState<string>("");
  const [sortAsc, setSortAsc] = useState(true);
  const [countState, setCountState] = useState<{ loading: boolean; value?: number; error?: string }>({ loading: false });
  const [view, setView] = useState<"table" | "chart">("table");

  // Chart view needs at least one numeric column and two points to say
  // anything; text output (FORMAT queries) has no columns to plot.
  const chartEligible = useMemo(() => {
    if (result.is_text || result.rows.length < 2) return false;
    return result.columns.some((c) => isNumericType(c.type));
  }, [result.is_text, result.rows.length, result.columns]);

  // Identity of this result: ChartView is keyed on it so axis selections
  // reset when a new result lands (and stay per-statement in multi-runs).
  const resultKey = `${result.query_id}|${result.timing_ms}|${result.row_count}|${result.rows.length}`;

  const countAllRows = async () => {
    if (!statement) return;
    setCountState({ loading: true });
    try {
      const n = await countQueryRows(statement);
      setCountState({ loading: false, value: n });
    } catch (e) {
      setCountState({ loading: false, error: errorText(e) });
    }
  };

  // Memoized filter+sort so it isn't recomputed on every keystroke/render.
  const sortedRows = useMemo(() => {
    const filtered = result.rows.filter((row) => {
      for (const [col, filter] of Object.entries(colFilters)) {
        if (!filter) continue;
        const val = row[col];
        const str = val === null || val === undefined ? "null" : String(val).toLowerCase();
        if (!str.includes(filter.toLowerCase())) return false;
      }
      return true;
    });
    if (!sortCol) return filtered;
    return filtered.sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      let cmp = 0;
      if (va === null || va === undefined) cmp = vb === null || vb === undefined ? 0 : -1;
      else if (vb === null || vb === undefined) cmp = 1;
      else if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return sortAsc ? cmp : -cmp;
    });
  }, [result.rows, colFilters, sortCol, sortAsc]);

  // Rows received from the server are already the current page (no client-side slicing).
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

  // Virtualize the body so large result pages don't render thousands of DOM
  // nodes. The scroll element is the table wrapper; the header is sticky.
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = 32;
  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? totalHeight - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div>
      {result.advisor && result.advisor.warnings.length > 0 && (
        <div
          role="note"
          className="mb-2 rounded-lg border border-[var(--color-warning, #b45309)] bg-[var(--surface-hover)] p-2.5"
        >
          <div className="flex flex-col gap-1.5">
            {result.advisor.warnings.map((w, i) => (
              <p key={i} className="text-xs text-[var(--color-text-primary)]">
                <TriangleAlert className="mr-1.5 inline h-3.5 w-3.5 text-[var(--color-warning, #b45309)]" />
                {w}
              </p>
            ))}
            {onSuggestion && result.advisor.suggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {result.advisor.suggestions.includes("add_limit") && (
                  <button
                    onClick={() => onSuggestion("add_limit")}
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    Add LIMIT 1000
                  </button>
                )}
                {result.advisor.suggestions.includes("set_max_execution_time") && (
                  <button
                    onClick={() => onSuggestion("set_max_execution_time")}
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    Limit to 5 min
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
              aria-label="Copy Query ID"
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
          {!totalKnown && statement && countState.value === undefined && (
            <button
              onClick={countAllRows}
              disabled={countState.loading}
              className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline disabled:opacity-50"
              title="Run SELECT count() over the full query — can be expensive on remote tables"
            >
              {countState.loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Count all rows
            </button>
          )}
          {countState.value !== undefined && (
            <span className="text-xs text-[var(--color-text-secondary)]">({formatNumber(countState.value)} total)</span>
          )}
          {countState.error && (
            <span className="text-xs text-[var(--color-error)]" title={countState.error}>count failed</span>
          )}
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
              {chartEligible && (
                <div className="mr-1 flex items-center rounded border border-[var(--color-border)]">
                  <button
                    onClick={() => setView("table")}
                    aria-pressed={view === "table"}
                    className={`flex items-center gap-1 rounded-l px-2 py-0.5 text-[10px] ${view === "table" ? "bg-[var(--state-accent)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                    title="Table view"
                  >
                    <Table2 className="h-3 w-3" />Table
                  </button>
                  <button
                    onClick={() => setView("chart")}
                    aria-pressed={view === "chart"}
                    className={`flex items-center gap-1 rounded-r px-2 py-0.5 text-[10px] ${view === "chart" ? "bg-[var(--state-accent)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                    title="Chart view"
                  >
                    <LineChartIcon className="h-3 w-3" />Chart
                  </button>
                </div>
              )}
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
      {result.is_text && result.output ? (
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--surface-base)] p-3 font-mono text-xs whitespace-pre text-[var(--color-text-primary)]">
          {result.output}
        </pre>
      ) : result.columns.length > 0 ? (
        view === "chart" && chartEligible ? (
          <ChartView key={resultKey} result={result} />
        ) : (
        <>
          <div ref={scrollRef} className="max-h-[60vh] overflow-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  {result.columns.map((c) => {
                    const active = sortCol === c.name;
                    return (
                      <th
                        key={c.name}
                        scope="col"
                        aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
                        className="select-none px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] whitespace-nowrap"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.name)}
                          aria-pressed={active}
                          className="inline-flex cursor-pointer items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
                        >
                          {c.name}
                          {active && (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                        </button>
                        <div className="text-[9px] font-normal opacity-60">{c.type}</div>
                      </th>
                    );
                  })}
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
                {paddingTop > 0 && (
                  <tr aria-hidden="true" style={{ height: paddingTop }}>
                    <td colSpan={result.columns.length} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = sortedRows[virtualRow.index];
                  return (
                    <tr key={virtualRow.key} style={{ height: virtualRow.size }} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]">
                      {result.columns.map((c) => (
                        <td key={c.name} className="max-w-sm px-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                          <CellValue val={row[c.name]} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {sortedRows.length === 0 && hasFilters && (
                  <tr>
                    <td colSpan={result.columns.length} className="px-4 py-4 text-center text-xs text-[var(--color-text-secondary)]">
                      No rows match filters
                    </td>
                  </tr>
                )}
                {paddingBottom > 0 && (
                  <tr aria-hidden="true" style={{ height: paddingBottom }}>
                    <td colSpan={result.columns.length} />
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
                aria-label="Previous page"
                className="rounded p-1 hover:bg-[var(--surface-elevated)] disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setResultPage((p) => p + 1)}
                disabled={!hasMore || pageLoading}
                aria-label="Next page"
                className="rounded p-1 hover:bg-[var(--surface-elevated)] disabled:opacity-30"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
        )
      ) : (
        <div className="text-sm text-[var(--color-text-secondary)]">Query executed successfully. No results returned.</div>
      )}
    </div>
  );
}
