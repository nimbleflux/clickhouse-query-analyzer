import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, Search, Clock, MemoryStick, ArrowUp, ArrowDown, Filter, ChevronLeft, ChevronRight, AlertTriangle, BarChart3 } from "lucide-react";
import { fetchFingerprints } from "../api/client";
import type { FingerprintListResponse } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const DATE_PRESETS: { label: string; hours: number }[] = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 168 },
  { label: "Last 30d", hours: 720 },
];

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
  const [showSystem, setShowSystem] = useState(false);
  const [fromTime, setFromTime] = useState<string>("");
  const [toTime, setToTime] = useState<string>("");
  const pageSize = 50;
  const debouncedSearch = useDebouncedValue(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchFingerprints({
        search: debouncedSearch || undefined,
        user: user || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
        hide_system_queries: showSystem ? false : true,
        from_time: fromTime || undefined,
        to_time: toTime || undefined,
      });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fingerprints");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, user, sortBy, sortDir, currentPage, showSystem, fromTime, toTime]);

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

  const applyDatePreset = (hours: number) => {
    setFromTime(new Date(Date.now() - hours * 3600 * 1000).toISOString());
    setToTime("");
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
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            type="text"
            placeholder="Search queries..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2 pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${
            showFilters
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
        <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => { setShowSystem(e.target.checked); setCurrentPage(1); }}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          Internal queries
        </label>
      </div>

      {showFilters && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="text-xs text-[var(--color-text-secondary)] self-center mr-1">Quick range:</span>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.hours}
                onClick={() => applyDatePreset(p.hours)}
                className="rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)]"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">From</label>
              <input
                type="datetime-local"
                value={fromTime ? fromTime.slice(0, 16) : ""}
                onChange={(e) => { setFromTime(e.target.value ? new Date(e.target.value).toISOString() : ""); setCurrentPage(1); }}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">To</label>
              <input
                type="datetime-local"
                value={toTime ? toTime.slice(0, 16) : ""}
                onChange={(e) => { setToTime(e.target.value ? new Date(e.target.value).toISOString() : ""); setCurrentPage(1); }}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">User</label>
              <input
                type="text"
                value={user}
                onChange={(e) => { setUser(e.target.value); setCurrentPage(1); }}
                placeholder="Username"
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">{error}</div>
      )}

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded border border-transparent py-3">
              <div className="h-4 w-28 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 w-12 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 w-16 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 w-10 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
              <div className="h-4 flex-1 animate-pulse rounded bg-[var(--color-bg-tertiary)]" />
            </div>
          ))}
        </div>
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
                  onClick={() => { setCurrentPage((p) => p - 1); document.querySelector("main")?.scrollTo(0, 0); }}
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => { setCurrentPage((p) => p + 1); document.querySelector("main")?.scrollTo(0, 0); }}
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
