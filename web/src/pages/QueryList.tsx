import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter, ChevronLeft, ChevronRight, Clock, MemoryStick, Database, Plug, GitCompare, ArrowUp, ArrowDown, AlertTriangle, Copy, List } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fetchQueries } from "../api/client";
import type { QueryListParams, QueryLogEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { TableSkeleton } from "../components/Skeleton";

const DATE_PRESETS: { label: string; hours: number }[] = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 24h", hours: 24 },
  { label: "Last 7d", hours: 168 },
  { label: "Last 30d", hours: 720 },
];

export function QueryList({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const copy = useCopyToClipboard();
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
    hide_system_queries: true,
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

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchQueries({ ...params, search: debouncedSearch || undefined, hide_system_queries: !showSystem }, controller.signal)
      .then((data) => { setQueries(data.queries || []); setTotal(data.total); })
      .catch((e) => { if (!(e instanceof DOMException)) setError(e instanceof Error ? e.message : "Failed to load queries"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [params, debouncedSearch, connected, showSystem]);

  const totalPages = Math.ceil(total / (params.limit || 50));
  const currentPage = Math.floor((params.offset || 0) / (params.limit || 50)) + 1;

  const applyDatePreset = (hours: number) => {
    const from = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    setParams((p) => ({ ...p, from_time: from, to_time: undefined, offset: 0 }));
  };

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
        <div className="flex items-center gap-3">
          <List className="h-5 w-5 text-[var(--color-text-secondary)]" />
          <h1 className="text-2xl font-bold">Queries</h1>
          <span className="text-sm text-[var(--color-text-secondary)]">
            {formatNumber(total)} queries found
          </span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            data-search-input
            type="text"
            placeholder="Search queries... (Ctrl+K)"
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
            onChange={(e) => {
              setShowSystem(e.target.checked);
              setParams((p) => ({ ...p, offset: 0 }));
            }}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          Internal queries
        </label>
      </div>

      {showFilters && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">From</label>
              <input
                type="datetime-local"
                value={params.from_time ? params.from_time.slice(0, 16) : ""}
                onChange={(e) => setParams((p) => ({ ...p, from_time: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 }))}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">To</label>
              <input
                type="datetime-local"
                value={params.to_time ? params.to_time.slice(0, 16) : ""}
                onChange={(e) => setParams((p) => ({ ...p, to_time: e.target.value ? new Date(e.target.value).toISOString() : undefined, offset: 0 }))}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none"
              />
            </div>
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
                <option value="Explain">EXPLAIN</option>
                <option value="Create">CREATE</option>
                <option value="System">SYSTEM</option>
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
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Sort Direction</label>
              <select
                value={params.sort_dir}
                onChange={(e) => setParams((p) => ({ ...p, sort_dir: e.target.value as "ASC" | "DESC", offset: 0 }))}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
              >
                <option value="DESC">Descending</option>
                <option value="ASC">Ascending</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {selected.size === 2 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)]/10 px-4 py-3">
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
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm">
          <div className="w-10 shrink-0 px-2 py-3"></div>
          <div className="w-40 shrink-0 px-4 py-3 font-medium text-[var(--color-text-secondary)]">
            <span className="inline-flex cursor-pointer items-center gap-1 select-none hover:text-[var(--color-text-primary)]" onClick={() => setParams((p) => ({ ...p, sort_by: "query_start_time", sort_dir: p.sort_by === "query_start_time" && p.sort_dir === "DESC" ? "ASC" : "DESC", offset: 0 }))}>
              Time
              {params.sort_by === "query_start_time" && (params.sort_dir === "DESC" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </span>
          </div>
          <div className="w-24 shrink-0 px-4 py-3 font-medium text-[var(--color-text-secondary)]">
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
          <div className="w-10 shrink-0 px-2 py-3"></div>
        </div>
        {loading && queries.length === 0 ? (
          <div className="px-4 py-6"><TableSkeleton rows={8} cols={7} /></div>
        ) : queries.length === 0 ? (
          <div className="px-4 py-12 text-center text-[var(--color-text-secondary)]">No queries found</div>
        ) : (
          <VirtualQueryRows
            queries={queries}
            selected={selected}
            onToggleSelect={toggleSelect}
            onNavigate={(id) => navigate(`/query/${id}`)}
            onCopy={copy}
          />
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-secondary)]">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={(params.offset || 0) === 0}
              onClick={() => { setParams((p) => ({ ...p, offset: Math.max(0, (p.offset || 0) - (p.limit || 50)) })); document.querySelector("main")?.scrollTo(0, 0); }}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <button
              disabled={currentPage >= totalPages}
              onClick={() => { setParams((p) => ({ ...p, offset: (p.offset || 0) + (p.limit || 50) })); document.querySelector("main")?.scrollTo(0, 0); }}
              className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
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

function VirtualQueryRows({
  queries,
  selected,
  onToggleSelect,
  onNavigate,
  onCopy,
}: {
  queries: QueryLogEntry[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onCopy: (text: string, label?: string) => void;
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
    <div ref={parentRef} className="max-h-[600px] overflow-auto text-sm">
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
              className={`absolute top-0 left-0 w-full flex cursor-pointer items-center border-b border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors ${selected.has(q.query_id) ? "bg-[var(--color-accent)]/10" : ""}`}
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
              <div className="w-24 shrink-0 whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{q.user}</div>
              <div className="min-w-0 flex-1 truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]" title={q.query}>
                <div className="flex items-center gap-1">
                  {q.type !== "QueryFinish" && <AlertTriangle className="h-3 w-3 shrink-0 text-[var(--color-error)]" />}
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
              <div className="w-10 shrink-0 px-2 py-3" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onCopy(q.query_id, "Query ID copied!")}
                  className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  title="Copy query ID"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
