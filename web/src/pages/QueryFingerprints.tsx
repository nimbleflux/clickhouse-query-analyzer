import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Fingerprint, Search, Clock, MemoryStick, ArrowUp, ArrowDown, Filter, ChevronLeft, ChevronRight, AlertTriangle, BarChart3 } from "lucide-react";
import { fetchFingerprints } from "../api/client";
import type { FingerprintListResponse } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input, Checkbox } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState } from "@/components/ui/state";

const DATE_PRESETS: { label: string; hours: number }[] = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 168 },
  { label: "Last 30d", hours: 720 },
];

function toCHDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

type SortField = "last_seen" | "execution_count" | "avg_duration_ms" | "p95_duration_ms" | "max_duration_ms" | "avg_memory_usage" | "max_memory_usage" | "error_count" | "avg_read_rows";

interface SortableHeaderProps {
  field: SortField;
  sortBy: SortField;
  sortDir: "DESC" | "ASC";
  onToggle: (field: SortField) => void;
  label: string;
  align?: "left" | "right";
}

function SortableHeader({ field, sortBy, sortDir, onToggle, label, align = "left" }: SortableHeaderProps) {
  const active = sortBy === field;
  return (
    <th
      className={`cursor-pointer px-4 py-2.5 font-medium text-[var(--color-text-secondary)] ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() => onToggle(field)}
    >
      <span className="inline-flex select-none items-center gap-1 hover:text-[var(--color-text-primary)]">
        {label}
        {active && (sortDir === "ASC" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

export function QueryFingerprints({ connected }: { connected: boolean }) {
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

  useEffect(() => { if (connected) load(); }, [load, connected]);

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
    setFromTime(toCHDateTime(new Date(Date.now() - hours * 3600 * 1000)));
    setToTime("");
    setCurrentPage(1);
  };

  if (!connected) return <NotConnectedState />;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Query Fingerprints"
        description={data ? `${data.total} unique queries` : undefined}
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
        <Checkbox
          checked={showSystem}
          onChange={(e) => { setShowSystem(e.target.checked); setCurrentPage(1); }}
          label="Internal queries"
        />
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 self-center text-xs text-[var(--color-text-secondary)]">Quick range:</span>
            {DATE_PRESETS.map((p) => (
              <Button key={p.hours} variant="outline" size="sm" onClick={() => applyDatePreset(p.hours)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">From</label>
              <Input
                type="datetime-local"
                value={fromTime ? fromTime.slice(0, 16) : ""}
                onChange={(e) => { setFromTime(e.target.value ? toCHDateTime(new Date(e.target.value)) : ""); setCurrentPage(1); }}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">To</label>
              <Input
                type="datetime-local"
                value={toTime ? toTime.slice(0, 16) : ""}
                onChange={(e) => { setToTime(e.target.value ? toCHDateTime(new Date(e.target.value)) : ""); setCurrentPage(1); }}
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
          </div>
        </Card>
      )}

      {error && <ErrorState error={error} onRetry={load} />}

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
        </Card>
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
                  <SortableHeader field="last_seen" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="Last Seen" />
                  <SortableHeader field="execution_count" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="Count" align="right" />
                  <SortableHeader field="avg_duration_ms" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="Avg Duration" align="right" />
                  <SortableHeader field="p95_duration_ms" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="P95 Duration" align="right" />
                  <SortableHeader field="avg_memory_usage" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="Avg Memory" align="right" />
                  <SortableHeader field="avg_read_rows" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="Avg Rows" align="right" />
                  <SortableHeader field="error_count" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} label="Errors" align="right" />
                  <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">Query</th>
                </tr>
              </thead>
              <tbody>
                {data.fingerprints.map((f) => (
                  <tr
                    key={f.normalized_query_hash}
                    onClick={() => navigate(`/fingerprints/${f.normalized_query_hash}`, { state: { query: f.sample_query } })}
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors"
                  >
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
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">
                Page {currentPage} of {totalPages} ({data.total} fingerprints)
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
