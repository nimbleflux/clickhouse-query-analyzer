import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter, ChevronLeft, ChevronRight, Clock, MemoryStick, Database, Plug, GitCompare } from "lucide-react";
import { fetchQueries } from "../api/client";
import type { QueryListParams, QueryLogEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";

export function QueryList({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const [queries, setQueries] = useState<QueryLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [params, setParams] = useState<QueryListParams>({
    limit: 50,
    offset: 0,
    sort_by: "query_start_time",
    sort_dir: "DESC",
  });
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  };

  const selectedArr = Array.from(selected);

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchQueries({ ...params, search: search || undefined });
      setQueries(data.queries || []);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queries");
    } finally {
      setLoading(false);
    }
  }, [params, search, connected]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.ceil(total / (params.limit || 50));
  const currentPage = Math.floor((params.offset || 0) / (params.limit || 50)) + 1;

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <Plug className="h-12 w-12 text-[var(--color-text-secondary)]" />
        <p className="text-lg font-medium text-[var(--color-text-secondary)]">Connect to ClickHouse</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Enter your connection details above to get started.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Queries</h1>
        <span className="text-sm text-[var(--color-text-secondary)]">
          {formatNumber(total)} queries found
        </span>
      </div>

      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            type="text"
            placeholder="Search queries..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setParams((p) => ({ ...p, offset: 0 }));
            }}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2 pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${
            showFilters
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-white"
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
      </div>

      {showFilters && (
        <div className="mb-4 grid grid-cols-4 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Query Kind</label>
            <select
              value={params.query_kind || ""}
              onChange={(e) => setParams((p) => ({ ...p, query_kind: e.target.value || undefined, offset: 0 }))}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
            >
              <option value="">All</option>
              <option value="Select">SELECT</option>
              <option value="Insert">INSERT</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">User</label>
            <input
              type="text"
              value={params.user || ""}
              onChange={(e) => setParams((p) => ({ ...p, user: e.target.value || undefined, offset: 0 }))}
              placeholder="Username"
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Min Duration (ms)</label>
            <input
              type="number"
              value={params.min_duration || ""}
              onChange={(e) =>
                setParams((p) => ({ ...p, min_duration: e.target.value ? Number(e.target.value) : undefined, offset: 0 }))
              }
              placeholder="e.g. 1000"
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Sort By</label>
            <select
              value={params.sort_by}
              onChange={(e) => setParams((p) => ({ ...p, sort_by: e.target.value, offset: 0 }))}
              className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
            >
              <option value="query_start_time">Time</option>
              <option value="query_duration_ms">Duration</option>
              <option value="memory_usage">Memory</option>
              <option value="read_rows">Rows Read</option>
              <option value="read_bytes">Bytes Read</option>
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--color-error)] bg-red-900/20 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {selected.size === 2 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-accent)] bg-blue-900/20 px-4 py-3">
          <span className="text-sm text-[var(--color-text-primary)]">2 queries selected</span>
          <button
            onClick={() => navigate(`/compare?a=${selectedArr[0]}&b=${selectedArr[1]}`)}
            className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            <GitCompare className="h-3.5 w-3.5" />
            Compare
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-[var(--color-text-secondary)] hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <th className="w-10 px-2 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">Time</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">Duration</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">Memory</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">Rows Read</th>
              <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">Bytes Read</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">User</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">Query</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-[var(--color-text-secondary)]">
                  Loading...
                </td>
              </tr>
            ) : queries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-[var(--color-text-secondary)]">
                  No queries found
                </td>
              </tr>
            ) : (
              queries.map((q) => (
                <tr
                  key={q.query_id}
                  onClick={() => navigate(`/query/${q.query_id}`)}
                  className={`cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors ${selected.has(q.query_id) ? "bg-blue-900/10" : ""}`}
                >
                  <td className="w-10 px-2 py-3" onClick={(e) => { e.stopPropagation(); toggleSelect(q.query_id); }}>
                    <input
                      type="checkbox"
                      checked={selected.has(q.query_id)}
                      disabled={!selected.has(q.query_id) && selected.size >= 2}
                      readOnly
                      className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]" onClick={() => navigate(`/query/${q.query_id}`)}>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTime(q.query_start_time)}
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 font-mono ${durationColor(q.query_duration_ms)}`}>
                    {formatDuration(q.query_duration_ms)}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-mono ${memoryColor(q.memory_usage)}`}>
                    <div className="flex items-center justify-end gap-1">
                      <MemoryStick className="h-3 w-3" />
                      {formatBytes(q.memory_usage)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                    {formatNumber(q.read_rows)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                    {formatBytes(q.read_bytes)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{q.user}</td>
                  <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                    <div className="flex items-center gap-1">
                      <Database className="h-3 w-3 shrink-0" />
                      <span className="truncate">{q.query}</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-secondary)]">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={(params.offset || 0) === 0}
              onClick={() => setParams((p) => ({ ...p, offset: Math.max(0, (p.offset || 0) - (p.limit || 50)) }))}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-white disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setParams((p) => ({ ...p, offset: (p.offset || 0) + (p.limit || 50) }))}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-white disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
