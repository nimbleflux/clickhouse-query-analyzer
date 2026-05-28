import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, Search, Clock, MemoryStick, ArrowUp, ArrowDown, Filter, ChevronLeft, ChevronRight, AlertTriangle, BarChart3 } from "lucide-react";
import { fetchFingerprints } from "../api/client";
import type { FingerprintListResponse } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";

type SortField = "last_seen" | "execution_count" | "avg_duration_ms" | "p95_duration_ms" | "max_duration_ms" | "avg_memory_usage" | "max_memory_usage" | "error_count" | "avg_read_rows";

export function QueryFingerprints() {
  const navigate = useNavigate();
  const [data, setData] = useState<FingerprintListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [user, setUser] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("last_seen");
  const [sortDir, setSortDir] = useState<"DESC" | "ASC">("DESC");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchFingerprints({
        search: search || undefined,
        user: user || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
      });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fingerprints");
    } finally {
      setLoading(false);
    }
  }, [search, user, sortBy, sortDir, currentPage]);

  useEffect(() => { load(); }, [load]);

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => d === "ASC" ? "DESC" : "ASC");
    } else {
      setSortBy(field);
      setSortDir("DESC");
    }
    setCurrentPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    sortBy === field ? (sortDir === "ASC" ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />) : null
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Fingerprint className="h-5 w-5 text-[var(--color-text-secondary)]" />
          <h2 className="text-lg font-semibold">Query Fingerprints</h2>
          {data && (
            <span className="text-sm text-[var(--color-text-secondary)]">
              {data.total} unique queries
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              placeholder="Search queries..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2 pl-8 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 rounded border px-3 py-2 text-sm ${showFilters ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3">
          <input
            type="text"
            placeholder="Filter by user..."
            value={user}
            onChange={(e) => { setUser(e.target.value); setCurrentPage(1); }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-error)] bg-red-900/20 px-4 py-3 text-sm text-[var(--color-error)]">{error}</div>
      )}

      {loading && !data ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">Loading fingerprints...</div>
      ) : data && data.fingerprints.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <Fingerprint className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p>No query fingerprints found</p>
        </div>
      ) : data ? (
        <>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                  <th className="cursor-pointer px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("last_seen")}>
                    Last Seen <SortIcon field="last_seen" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("execution_count")}>
                    Count <SortIcon field="execution_count" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("avg_duration_ms")}>
                    Avg Duration <SortIcon field="avg_duration_ms" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("p95_duration_ms")}>
                    P95 Duration <SortIcon field="p95_duration_ms" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("avg_memory_usage")}>
                    Avg Memory <SortIcon field="avg_memory_usage" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("avg_read_rows")}>
                    Avg Rows <SortIcon field="avg_read_rows" />
                  </th>
                  <th className="cursor-pointer px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]" onClick={() => toggleSort("error_count")}>
                    Errors <SortIcon field="error_count" />
                  </th>
                  <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">Query</th>
                </tr>
              </thead>
              <tbody>
                {data.fingerprints.map((f) => (
                  <tr key={f.normalized_query_hash} onClick={() => navigate(`/fingerprints/${f.normalized_query_hash}`, { state: { query: f.sample_query } })} className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(f.last_seen)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-primary)]">
                      <div className="flex items-center justify-end gap-1">
                        <BarChart3 className="h-3 w-3 text-[var(--color-text-secondary)]" />
                        {formatNumber(f.execution_count)}
                      </div>
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-mono ${durationColor(f.avg_duration_ms)}`}>
                      {formatDuration(f.avg_duration_ms)}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-mono ${durationColor(f.p95_duration_ms)}`}>
                      {formatDuration(f.p95_duration_ms)}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-mono ${memoryColor(f.avg_memory_usage)}`}>
                      <div className="flex items-center justify-end gap-1">
                        <MemoryStick className="h-3 w-3" />
                        {formatBytes(f.avg_memory_usage)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                      {formatNumber(f.avg_read_rows)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono">
                      {f.error_count > 0 ? (
                        <span className="text-[var(--color-error)]" title={f.last_error || undefined}>{formatNumber(f.error_count)}</span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)]">-</span>
                      )}
                    </td>
                    <td className="max-w-lg truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                      <div className="flex items-center gap-1">
                        {f.error_count > 0 && <span title={f.last_error || undefined}><AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-error)]" /></span>}
                        <span className="truncate" title={f.sample_query}>{f.sample_query}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)] opacity-60">
                        {f.query_kind} &middot; {f.users.join(", ")}
                      </div>
                      {f.error_count > 0 && f.last_error && (
                        <div className="mt-0.5 truncate text-[10px] text-[var(--color-error)] opacity-80" title={f.last_error}>
                          {f.last_error}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">
                Page {currentPage} of {totalPages} ({data.total} fingerprints)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
      </div>
    </div>
  );
}
