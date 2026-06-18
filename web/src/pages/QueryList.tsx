import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter, ChevronLeft, ChevronRight, Clock, MemoryStick, Database, GitCompare, ArrowUp, ArrowDown, Copy, FileSearch, Code } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fetchQueries } from "../api/client";
import type { QueryListParams, QueryLogEntry } from "../api/types";
import { ApiError } from "../api/errors";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { sendToEditor } from "@/lib/send-to-editor";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input, Select, Checkbox } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState } from "@/components/ui/state";
import { Badge } from "@/components/ui/badge";

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

export function QueryList({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const copy = useCopyToClipboard();
  const [queries, setQueries] = useState<QueryLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [cachedTotal, setCachedTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [params, setParams] = useState<QueryListParams>({
    limit: 50,
    offset: 0,
    sort_by: "event_time",
    sort_dir: "DESC",
    hide_system_queries: true,
    from_time: toCHDateTime(new Date(Date.now() - 24 * 3600 * 1000)),
  });
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  };

  const selectedArr = Array.from(selected);

  const isFirstPage = (params.offset || 0) === 0;
  const hasDateFilter = !!(params.from_time || params.to_time);
  const wantsCount = isFirstPage && hasDateFilter;

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    fetchQueries(
      { ...params, search: debouncedSearch || undefined, hide_system_queries: !showSystem, include_count: wantsCount },
      controller.signal,
    )
      .then((data) => {
        if (!active) return;
        setQueries(data.queries || []);
        if (wantsCount) {
          setTotal(data.total);
          setCachedTotal(data.total);
        }
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiError && e.isAbort()) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof ApiError ? e : ApiError.wrap(e));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [params, debouncedSearch, connected, showSystem, wantsCount]);

  const displayTotal = cachedTotal ?? total;
  const totalPages = displayTotal > 0 ? Math.ceil(displayTotal / (params.limit || 50)) : 0;
  const currentPage = Math.floor((params.offset || 0) / (params.limit || 50)) + 1;
  const totalKnown = displayTotal > 0;

  const applyDatePreset = (hours: number) => {
    setTotal(0);
    setCachedTotal(null);
    if (hours === 0) {
      setParams((p) => ({ ...p, from_time: undefined, to_time: undefined, offset: 0 }));
      return;
    }
    const from = toCHDateTime(new Date(Date.now() - hours * 3600 * 1000));
    setParams((p) => ({ ...p, from_time: from, to_time: undefined, offset: 0 }));
  };

  const reload = () => {
    setParams((p) => ({ ...p }));
  };

  if (!connected) {
    return <NotConnectedState />;
  }

  return (
    <PageContainer>
      <PageHeader
        heading="h1"
        title="Queries"
        description={
          total > 0 ? `${formatNumber(total)} queries found` : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            data-search-input
            type="text"
            placeholder="Search queries… (Ctrl+K)"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setParams((p) => ({ ...p, offset: 0 }));
            }}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] outline-none transition-colors focus:border-[var(--color-accent)]"
          />
        </div>
        <Button
          variant={showFilters ? "primary" : "secondary"}
          size="md"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
        </Button>
        <Checkbox
          checked={showSystem}
          onChange={(e) => {
            setShowSystem(e.target.checked);
            setParams((p) => ({ ...p, offset: 0 }));
          }}
          label="Internal queries"
        />
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 self-center text-xs text-[var(--color-text-secondary)]">Quick range:</span>
            {DATE_PRESETS.map((p) => (
              <Button
                key={p.hours}
                variant="outline"
                size="sm"
                onClick={() => applyDatePreset(p.hours)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">From</label>
              <Input
                type="datetime-local"
                value={params.from_time ? params.from_time.slice(0, 16) : ""}
                onChange={(e) => setParams((p) => ({ ...p, from_time: e.target.value ? toCHDateTime(new Date(e.target.value)) : undefined, offset: 0 }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">To</label>
              <Input
                type="datetime-local"
                value={params.to_time ? params.to_time.slice(0, 16) : ""}
                onChange={(e) => setParams((p) => ({ ...p, to_time: e.target.value ? toCHDateTime(new Date(e.target.value)) : undefined, offset: 0 }))}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">Query Kind</label>
              <Select
                value={params.query_kind || ""}
                onChange={(e) => setParams((p) => ({ ...p, query_kind: e.target.value || undefined, offset: 0 }))}
                className="w-full"
              >
                <option value="">All</option>
                <option value="Select">SELECT</option>
                <option value="Insert">INSERT</option>
                <option value="Explain">EXPLAIN</option>
                <option value="Create">CREATE</option>
                <option value="System">SYSTEM</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">User</label>
              <Input
                value={params.user || ""}
                onChange={(e) => setParams((p) => ({ ...p, user: e.target.value || undefined, offset: 0 }))}
                placeholder="Username"
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">Min Duration (ms)</label>
              <Input
                type="number"
                value={params.min_duration || ""}
                onChange={(e) =>
                  setParams((p) => ({ ...p, min_duration: e.target.value ? Number(e.target.value) : undefined, offset: 0 }))
                }
                placeholder="e.g. 1000"
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">Sort Direction</label>
              <Select
                value={params.sort_dir}
                onChange={(e) => setParams((p) => ({ ...p, sort_dir: e.target.value as "ASC" | "DESC", offset: 0 }))}
                className="w-full"
              >
                <option value="DESC">Descending</option>
                <option value="ASC">Ascending</option>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <ErrorState error={error} onRetry={reload} />
      )}

      {selected.size > 0 && selected.size < 2 && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          <GitCompare className="h-3.5 w-3.5" />
          Select one more query to compare (max 2).
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Clear
          </button>
        </div>
      )}

      {selected.size === 2 && (
        <div className="flex items-center gap-3 rounded-md border border-[var(--color-accent)]/30 bg-[var(--state-accent)] px-4 py-2">
          <Badge variant="default">2 selected</Badge>
          <span className="text-xs text-[var(--color-text-secondary)]">Ready to compare</span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(`/compare?a=${selectedArr[0]}&b=${selectedArr[1]}`)}
            >
              <GitCompare className="h-3.5 w-3.5" />
              Compare
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className={`overflow-hidden rounded-lg border border-[var(--color-border)] ${loading && queries.length > 0 ? "opacity-50 pointer-events-none transition-opacity" : ""}`}>
        <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--surface-card)] text-sm">
          <div className="w-10 shrink-0 px-2 py-3"></div>
          <div className="w-40 shrink-0 px-4 py-3 font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "event_time", sort_dir: p.sort_by === "event_time" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              Time
              {params.sort_by === "event_time" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="w-32 shrink-0 px-4 py-3 font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "user", sort_dir: p.sort_by === "user" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              User
              {params.sort_by === "user" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="flex-1 px-4 py-3 font-medium text-[var(--color-text-secondary)]">Query</div>
          <div className="w-28 shrink-0 px-4 py-3 font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "query_duration_ms", sort_dir: p.sort_by === "query_duration_ms" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              Duration
              {params.sort_by === "query_duration_ms" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="w-28 shrink-0 px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "memory_usage", sort_dir: p.sort_by === "memory_usage" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              Memory
              {params.sort_by === "memory_usage" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="w-24 shrink-0 px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "read_rows", sort_dir: p.sort_by === "read_rows" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              Rows Read
              {params.sort_by === "read_rows" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="w-28 shrink-0 px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "read_bytes", sort_dir: p.sort_by === "read_bytes" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              Bytes Read
              {params.sort_by === "read_bytes" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="w-20 shrink-0 px-2 py-3"></div>
        </div>
        {loading && queries.length === 0 ? (
          <div className="px-4 py-6"><TableSkeleton rows={20} cols={7} /></div>
        ) : queries.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No queries found"
            description="Try adjusting your filters or expanding the time range."
            className="rounded-none border-0"
          />
        ) : (
          <VirtualQueryRows
            queries={queries}
            selected={selected}
            onToggleSelect={toggleSelect}
            onNavigate={(id) => navigate(`/query/${id}`)}
            onCopy={copy}
            onSendToEditor={(sql) => sendToEditor(navigate, sql, { origin: "query-list" })}
          />
        )}
      </div>

      {(totalPages > 1 || !totalKnown || (params.offset || 0) > 0) && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-secondary)]">
            {totalKnown ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`}
            {loading && <span className="ml-2 animate-pulse">Loading…</span>}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={(params.offset || 0) === 0 || loading}
              onClick={() => { setParams((p) => ({ ...p, offset: Math.max(0, (p.offset || 0) - (p.limit || 50)) })); document.querySelector("main")?.scrollTo(0, 0); }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={loading || (totalKnown && currentPage >= totalPages) || queries.length < (params.limit || 50)}
              onClick={() => { setParams((p) => ({ ...p, offset: (p.offset || 0) + (p.limit || 50) })); document.querySelector("main")?.scrollTo(0, 0); }}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function VirtualQueryRows({
  queries,
  selected,
  onToggleSelect,
  onNavigate,
  onCopy,
  onSendToEditor,
}: {
  queries: QueryLogEntry[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onCopy: (text: string, label?: string) => void;
  onSendToEditor: (sql: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowHeight = 45;

  const virtualizer = useVirtualizer({
    count: queries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  useEffect(() => {
    if (parentRef.current) parentRef.current.scrollTop = 0;
  }, [queries]);

  return (
    <div ref={parentRef} className="max-h-[calc(100vh-280px)] overflow-auto text-sm">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const q = queries[virtualRow.index];
          return (
            <div
              key={q.query_id}
              onClick={() => onNavigate(q.query_id)}
              className={`absolute top-0 left-0 w-full flex cursor-pointer items-center border-b border-[var(--color-border)] hover:bg-[var(--surface-hover)] transition-colors ${selected.has(q.query_id) ? "bg-[var(--state-accent)]" : ""}`}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="w-10 shrink-0 px-2 py-3" onClick={(e) => { e.stopPropagation(); onToggleSelect(q.query_id); }}>
                <input
                  type="checkbox"
                  checked={selected.has(q.query_id)}
                  disabled={!selected.has(q.query_id) && selected.size >= 2}
                  readOnly
                  className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                />
              </div>
              <div className="w-40 shrink-0 whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(q.query_start_time)}
                </div>
              </div>
              <div className="w-32 shrink-0 truncate px-4 py-3 text-[var(--color-text-secondary)]" title={q.user}>{q.user}</div>
              <div className="min-w-0 flex-1 truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]" title={q.query}>
                <div className="flex items-center gap-1">
                  {(q.type === "ExceptionBeforeStart" || q.type === "ExceptionWhileProcessing") && (
                    <span className="shrink-0 rounded bg-[var(--state-error)] px-1 py-0.5 text-[9px] font-medium text-[var(--color-error)]" title={q.exception || undefined}>Error</span>
                  )}
                  <Database className="h-3 w-3 shrink-0" />
                  <span className="truncate">{q.query}</span>
                </div>
              </div>
              <div className={`w-28 shrink-0 whitespace-nowrap px-4 py-3 font-mono ${durationColor(q.query_duration_ms)}`}>
                {formatDuration(q.query_duration_ms)}
              </div>
              <div className={`w-28 shrink-0 whitespace-nowrap px-4 py-3 text-right font-mono ${memoryColor(q.memory_usage)}`}>
                <div className="flex items-center justify-end gap-1">
                  <MemoryStick className="h-3 w-3" />
                  {formatBytes(q.memory_usage)}
                </div>
              </div>
              <div className="w-24 shrink-0 whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                {formatNumber(q.read_rows)}
              </div>
              <div className="w-28 shrink-0 whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                {formatBytes(q.read_bytes)}
              </div>
              <div className="w-20 shrink-0 px-2 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => onSendToEditor(q.query)}
                    className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    title="Open in Editor"
                  >
                    <Code className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onCopy(q.query_id, "Query ID copied!")}
                    className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    title="Copy query ID"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
