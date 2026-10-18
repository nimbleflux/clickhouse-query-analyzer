import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Fingerprint, Search, Clock, MemoryStick, AlertTriangle, ChevronLeft, ChevronRight, Filter, BarChart3, Download } from "lucide-react";
import { fetchFingerprints } from "../api/client";
import type { FingerprintListResponse } from "../api/types";
import { formatDuration, formatBytes, formatNumber, durationColor, memoryColor } from "../utils";
import { useDisplayDateTime } from "../hooks/useAppSettings";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { usePollingQuery } from "@/hooks/usePollingQuery";
import { downloadTable } from "@/lib/export";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input, Checkbox } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { SortableHeader } from "@/components/ui/table-sort";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";

const DATE_PRESETS: { label: string; hours: number }[] = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 168 },
  { label: "Last 30d", hours: 720 },
  { label: "All time", hours: 0 },
];

function toCHDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

type SortField = "last_seen" | "execution_count" | "avg_duration_ms" | "p95_duration_ms" | "max_duration_ms" | "avg_memory_usage" | "max_memory_usage" | "error_count" | "avg_read_rows";

const SORT_FIELDS: SortField[] = [
  "last_seen", "execution_count", "avg_duration_ms", "p95_duration_ms", "max_duration_ms",
  "avg_memory_usage", "max_memory_usage", "error_count", "avg_read_rows",
];

// The ?sort_by= param is user-editable, so validate it before trusting it.
function sortFieldFromParam(v: string): SortField {
  return (SORT_FIELDS as string[]).includes(v) ? (v as SortField) : "last_seen";
}

export function QueryFingerprints({ connected }: { connected: boolean }) {
  // Honors the display-timezone setting (Layout footer Globe toggle).
  const formatDateTime = useDisplayDateTime();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlParam = (k: string) => searchParams.get(k) ?? "";
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState(urlParam("q"));
  const [user, setUser] = useState(urlParam("user"));
  const [logComment, setLogComment] = useState(urlParam("log_comment"));
  const [sortBy, setSortBy] = useState<SortField>(sortFieldFromParam(urlParam("sort_by")));
  const [sortDir, setSortDir] = useState<"DESC" | "ASC">(urlParam("sort_dir") === "ASC" ? "ASC" : "DESC");
  const [currentPage, setCurrentPage] = useState(() => Math.max(1, Number(urlParam("page")) || 1));
  const [showSystem, setShowSystem] = useState(false);
  const [fromTime, setFromTime] = useState<string>(
    () => urlParam("from_time") || toCHDateTime(new Date(Date.now() - 24 * 3600 * 1000)),
  );
  const [toTime, setToTime] = useState<string>(urlParam("to_time"));
  const [cachedTotal, setCachedTotal] = useState<number | null>(null);
  const pageSize = 50;
  const debouncedSearch = useDebouncedValue(search, 300);

  const isFirstPage = currentPage === 1;
  const hasDateFilter = !!(fromTime || toTime);
  const wantsCount = isFirstPage && hasDateFilter;

  const fetcher = useCallback(async (signal: AbortSignal) => {
    const result = await fetchFingerprints({
      search: debouncedSearch || undefined,
      user: user || undefined,
      log_comment: logComment || undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
      hide_system_queries: showSystem ? false : true,
      from_time: fromTime || undefined,
      to_time: toTime || undefined,
      include_count: wantsCount,
      no_clamp: !fromTime ? true : undefined,
    }, signal);
    if (wantsCount) setCachedTotal(result.total);
    return result;
  }, [debouncedSearch, user, logComment, sortBy, sortDir, currentPage, showSystem, fromTime, toTime, wantsCount]);

  const {
    data,
    loading,
    error,
    canceled,
    elapsed,
    cancel,
    reload,
  } = usePollingQuery<FingerprintListResponse>(fetcher, { enabled: connected });

  // Keep the URL in sync with the active filters so views are shareable and
  // drill-down links (e.g. ?user=X) work. Uses replace to avoid history spam.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (search) sp.set("q", search);
    if (user) sp.set("user", user);
    if (logComment) sp.set("log_comment", logComment);
    if (fromTime) sp.set("from_time", fromTime);
    if (toTime) sp.set("to_time", toTime);
    if (sortBy !== "last_seen") sp.set("sort_by", sortBy);
    if (sortDir !== "DESC") sp.set("sort_dir", sortDir);
    if (currentPage > 1) sp.set("page", String(currentPage));
    setSearchParams(sp, { replace: true });
  }, [search, user, logComment, fromTime, toTime, sortBy, sortDir, currentPage, setSearchParams]);

  const displayTotal = cachedTotal ?? (data?.total ?? 0);
  const totalPages = displayTotal > 0 ? Math.ceil(displayTotal / pageSize) : 0;

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => d === "ASC" ? "DESC" : "ASC");
    } else {
      setSortBy(field);
      setSortDir("DESC");
    }
    setCurrentPage(1);
  };

  // Which quick-range preset is active (null = a custom From/To range is set).
  const [preset, setPreset] = useState<number | null>(24);

  const openFingerprint = useCallback((hash: string, sampleQuery: string) => {
    navigate(`/fingerprints/${hash}`, { state: { query: sampleQuery } });
  }, [navigate]);

  // Export exactly what the current page shows (same columns, same order),
  // with the time column formatted like the UI.
  const fingerprints = data?.fingerprints ?? [];
  const exportCurrentPage = (format: "csv" | "json") => {
    downloadTable(
      format === "csv" ? "query-fingerprints.csv" : "query-fingerprints.json",
      ["Last Seen", "Count", "Avg Duration (ms)", "P95 Duration (ms)", "Avg Memory (bytes)", "Avg Rows", "Errors", "Query"],
      fingerprints.map((f) => [
        formatDateTime(f.last_seen),
        f.execution_count,
        f.avg_duration_ms,
        f.p95_duration_ms,
        f.avg_memory_usage,
        f.avg_read_rows,
        f.error_count,
        f.sample_query,
      ]),
      format,
    );
  };

  const applyDatePreset = (hours: number) => {
    setPreset(hours);
    setCachedTotal(null);
    if (hours === 0) {
      setFromTime("");
      setToTime("");
      setCurrentPage(1);
      return;
    }
    setFromTime(toCHDateTime(new Date(Date.now() - hours * 3600 * 1000)));
    setToTime("");
    setCurrentPage(1);
  };

  if (!connected) return <NotConnectedState />;

  return (
    <PageContainer>
      <PageHeader
        title="Query Fingerprints"
        description={displayTotal > 0 ? `${formatNumber(displayTotal)} unique queries` : undefined}
        actions={
          <>
            {loading && data ? <RefreshIndicator elapsed={elapsed} /> : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCurrentPage("csv")}
              disabled={fingerprints.length === 0}
              title="Download this page's rows as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCurrentPage("json")}
              disabled={fingerprints.length === 0}
              title="Download this page's rows as JSON"
            >
              <Download className="h-3.5 w-3.5" />
              Export JSON
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            data-search-input
            type="text"
            placeholder="Search fingerprints… (Ctrl+K)"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] outline-none transition-colors focus:border-[var(--color-accent)]"
          />
        </div>
        <Button variant={showFilters ? "primary" : "secondary"} size="md" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-3.5 w-3.5" />
          Filters
        </Button>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 self-center text-xs text-[var(--color-text-secondary)]">Quick range:</span>
            <TimeframeSelector
              options={DATE_PRESETS.map((p) => ({ label: p.label, value: p.hours }))}
              value={preset ?? -1}
              onChange={applyDatePreset}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">From</label>
              <Input
                type="datetime-local"
                value={fromTime ? fromTime.slice(0, 16) : ""}
                onChange={(e) => { setPreset(null); setFromTime(e.target.value ? toCHDateTime(new Date(e.target.value)) : ""); setCurrentPage(1); }}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">To</label>
              <Input
                type="datetime-local"
                value={toTime ? toTime.slice(0, 16) : ""}
                onChange={(e) => { setPreset(null); setToTime(e.target.value ? toCHDateTime(new Date(e.target.value)) : ""); setCurrentPage(1); }}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">User</label>
              <Input
                value={user}
                onChange={(e) => { setUser(e.target.value); setCurrentPage(1); }}
                placeholder="Username"
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">Log Comment</label>
              <Input
                value={logComment}
                onChange={(e) => { setLogComment(e.target.value); setCurrentPage(1); }}
                placeholder="e.g. %nightly%"
                title="SQL LIKE pattern on log_comment. % and _ are wildcards."
                className="w-full font-mono"
              />
            </div>
          </div>
          <div className="mt-3">
            <Checkbox
              checked={showSystem}
              onChange={(e) => { setShowSystem(e.target.checked); setCurrentPage(1); }}
              label="Internal queries"
            />
          </div>
        </Card>
      )}

      {error && <ErrorState error={error} onRetry={reload} />}

      {loading && !data ? (
        <Card className="p-4">
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-2">
                <div className="h-4 w-28 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 w-12 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 w-20 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 w-20 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 w-20 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 w-16 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 w-10 animate-pulse rounded bg-[var(--surface-elevated)]" />
                <div className="h-4 flex-1 animate-pulse rounded bg-[var(--surface-elevated)]" />
              </div>
            ))}
          </div>
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </Card>
      ) : canceled && !data ? (
        <LoadingNotice canceled onRetry={reload} />
      ) : data && data.fingerprints.length === 0 ? (
        <EmptyState
          icon={Fingerprint}
          title="No query fingerprints found"
          description="Try adjusting filters, expanding the time range, or enabling internal queries."
        />
      ) : data ? (
        <>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <SortableHeader field="last_seen" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="Last Seen" className="px-4 py-2.5" />
                  <SortableHeader field="execution_count" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="Count" align="right" className="px-4 py-2.5" />
                  <SortableHeader field="avg_duration_ms" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="Avg Duration" align="right" className="px-4 py-2.5" />
                  <SortableHeader field="p95_duration_ms" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="P95 Duration" align="right" className="px-4 py-2.5" />
                  <SortableHeader field="avg_memory_usage" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="Avg Memory" align="right" className="px-4 py-2.5" />
                  <SortableHeader field="avg_read_rows" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="Avg Rows" align="right" className="px-4 py-2.5" />
                  <SortableHeader field="error_count" activeField={sortBy} dir={sortDir === "ASC" ? "asc" : "desc"} onToggle={toggleSort} label="Errors" align="right" className="px-4 py-2.5" />
                  <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">Query</th>
                </tr>
              </thead>
              <tbody>
                {data.fingerprints.map((f) => (
                  <tr
                    key={f.normalized_query_hash}
                    onClick={() => openFingerprint(f.normalized_query_hash, f.sample_query)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openFingerprint(f.normalized_query_hash, f.sample_query);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open fingerprint from ${formatDateTime(f.last_seen)}`}
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(f.last_seen)}
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
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">
                Page {currentPage} of {totalPages} ({formatNumber(displayTotal)} fingerprints)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={currentPage <= 1}
                  onClick={() => { setCurrentPage((p) => p - 1); document.querySelector("main")?.scrollTo(0, 0); }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={currentPage >= totalPages}
                  onClick={() => { setCurrentPage((p) => p + 1); document.querySelector("main")?.scrollTo(0, 0); }}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </PageContainer>
  );
}
