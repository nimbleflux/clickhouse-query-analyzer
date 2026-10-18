import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { Search, RefreshCw, X, ExternalLink, ArrowRight, Wrench } from "lucide-react";
import { fetchSchemaGraph, fetchColumns } from "@/api/client";
import type { SchemaGraphData, SchemaGraphNode, SchemaKind, HeatMetric } from "@/api/types";
import { SchemaGraphView } from "@/components/SchemaGraphView";
import { KIND_HUES, KIND_LABELS, nodeKey } from "./schema-graph/dot";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DdlButton } from "@/components/TableName";
import { EmptyState, ErrorState, NotConnectedState, LoadingNotice, RefreshIndicator } from "@/components/ui/state";
import { sendToEditor } from "@/lib/send-to-editor";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatNumber, formatBytes } from "@/utils";
import { ApiError } from "@/api/errors";

const ALL_KINDS = Object.keys(KIND_HUES) as SchemaKind[];
const LOAD_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

const HEAT_METRICS: { value: HeatMetric; label: string }[] = [
  { value: "duration", label: "View duration" },
  { value: "written_rows", label: "Rows written" },
  { value: "written_bytes", label: "Bytes written" },
  { value: "read_rows", label: "Rows read" },
  { value: "read_bytes", label: "Bytes read" },
  { value: "peak_memory", label: "Peak memory" },
  { value: "executions", label: "Executions" },
];

export function SchemaGraph({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const [graph, setGraph] = useState<SchemaGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadDays, setLoadDays] = useState(0);
  const [heatMetric, setHeatMetric] = useState<HeatMetric>("duration");
  // One database at a time by default — unfiltered graphs don't scale past a
  // handful of tables. With dbFilter = null the SERVER auto-picks the first
  // database, so even the initial response is scoped. "All databases" is an
  // explicit choice (allTables; the backend caps it and says so).
  const [dbFilter, setDbFilter] = useState<string | null>(null);
  const [allTables, setAllTables] = useState(false);
  const dbTouchedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [visibleKinds, setVisibleKinds] = useState<Set<SchemaKind>>(new Set(ALL_KINDS));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const elapsed = useElapsedTimer(loading);

  const load = useCallback(() => {
    if (!connected) return;
    // Abort the previous fetch: two concurrent loads would race, and a stale
    // .finally(() => setLoading(false)) could stick over a newer in-flight
    // one (e.g. Refresh clicked while the initial load was still running).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    fetchSchemaGraph(loadDays, allTables ? null : dbFilter, allTables, controller.signal)
      .then((data) => {
        if (abortRef.current !== controller) return;
        setGraph(data);
        setFitSignal((n) => n + 1);
      })
      .catch((e) => {
        if (abortRef.current !== controller) return;
        if (e instanceof ApiError && e.isAbort()) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof ApiError ? e : ApiError.wrap(e));
      })
      .finally(() => {
        if (abortRef.current !== controller) return;
        setLoading(false);
      });
  }, [connected, loadDays, dbFilter, allTables]);

  // The effect and the Refresh/Retry buttons go through the same entry point:
  // the ref stays current across filter changes, so a click can never run a
  // stale closure or dodge the abort-the-previous-load logic.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
    load();
    return () => abortRef.current?.abort();
  }, [load]);
  const refresh = useCallback(() => loadRef.current(), []);

  // The database the graph is currently scoped to: the user's explicit
  // choice, or the server's auto-pick reported in the response.
  const activeDb = dbTouchedRef.current
    ? (allTables ? "all" : dbFilter ?? "")
    : (graph?.database ?? "");

  // Reset the selection when it leaves the (filtered) graph.
  const selected = useMemo(
    () => graph?.nodes.find((n) => nodeKey(n) === selectedKey) ?? null,
    [graph, selectedKey],
  );
  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(null);
  }, [selectedKey, selected]);

  const dbOptions = useMemo(
    () => graph?.databases.map((d) => [d.database, d.tables] as [string, number]) ?? [],
    [graph],
  );

  const kindCounts = useMemo(() => {
    const counts = new Map<SchemaKind, number>();
    for (const n of graph?.nodes ?? []) {
      counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    }
    return counts;
  }, [graph]);

  const toggleKind = (kind: SchemaKind) => {
    setVisibleKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  if (!connected) {
    return (
      <PageContainer>
        <NotConnectedState />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Schema Graph"
        description="Tables and their dependencies — materialized view flows, dictionary sources, distributed shards. Click a table for details."
        actions={
          <div className="flex items-center gap-2">
            {loading && graph && <RefreshIndicator elapsed={elapsed} />}
            <Select
              value={String(loadDays)}
              onChange={(e) => setLoadDays(Number(e.target.value))}
              title="Lookback window for the materialized view INSERT load overlay (from query_views_log)"
              className="w-44"
            >
              {LOAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>Lookback: {o.label}</option>
              ))}
            </Select>
            <Select
              value={heatMetric}
              onChange={(e) => setHeatMetric(e.target.value as HeatMetric)}
              disabled={loadDays === 0}
              title="Which query_views_log metric the heat-map colors by"
              className="w-48"
            >
              {HEAT_METRICS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
            <Button variant="secondary" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {error && graph === null ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : graph === null ? (
        <LoadingNotice elapsed={elapsed} />
      ) : graph.nodes.length === 0 ? (
        <EmptyState
          title="No tables found"
          description="This ClickHouse instance has no user databases or tables yet."
        />
      ) : (
        <>
          {graph.note && (
            <div className="mb-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--state-warning)] px-3 py-2 text-xs text-[var(--color-text-primary)]">
              {graph.note}
            </div>
          )}
          {graph.partial_errors && graph.partial_errors.length > 0 && (
            <details className="mb-2 rounded-md border border-[var(--color-border)] bg-[var(--surface-hover)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              <summary className="cursor-pointer">Partial data ({graph.partial_errors.length})</summary>
              <ul className="mt-1 list-disc pl-4">
                {graph.partial_errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tables…"
                className="pl-9"
              />
            </div>
            <Select
              value={activeDb}
              onChange={(e) => {
                dbTouchedRef.current = true;
                setSelectedKey(null);
                if (e.target.value === "all") {
                  setAllTables(true);
                  setDbFilter(null);
                } else {
                  setAllTables(false);
                  setDbFilter(e.target.value || null);
                }
              }}
              className="w-56"
              title="Pick a database. “All databases” is capped at 400 tables and may be slow on large instances."
            >
              <option value="all">All databases ({graph.nodes.length} shown)</option>
              {dbOptions.map(([db, count]) => (
                <option key={db} value={db}>{db} ({count})</option>
              ))}
            </Select>
            <div className="flex flex-wrap items-center gap-1.5">
              {ALL_KINDS.filter((k) => (kindCounts.get(k) ?? 0) > 0).map((kind) => {
                const active = visibleKinds.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleKind(kind)}
                    aria-pressed={active}
                    title={active ? "Hide this kind" : "Show this kind"}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-[var(--color-border)] bg-[var(--surface-card)] text-[var(--color-text-primary)]"
                        : "border-transparent bg-transparent text-[var(--color-text-secondary)] opacity-60"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: KIND_HUES[kind] }} />
                    {KIND_LABELS[kind]}
                    <span className="text-[var(--color-text-secondary)]">{kindCounts.get(kind) ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex h-[calc(100vh-330px)] min-h-[460px] gap-3">
            <div className="min-w-0 flex-1">
              <SchemaGraphView
                graph={graph}
                visibleKinds={visibleKinds}
                dbFilter={dbFilter}
                search={debouncedSearch}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                fitSignal={fitSignal}
                heatMetric={heatMetric}
              />
            </div>
            {selected && (
              <NodeDetailPanel
                graph={graph}
                node={selected}
                onClose={() => setSelectedKey(null)}
                onSelect={setSelectedKey}
                onNavigate={navigate}
              />
            )}
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-text-secondary)] opacity-70">
            Scroll to zoom, drag to pan, click a table for details, click the background to clear. Arrows point in the direction data flows: source → materialized view → target.
          </p>
        </>
      )}
    </PageContainer>
  );
}

function NodeDetailPanel({
  graph,
  node,
  onClose,
  onSelect,
  onNavigate,
}: {
  graph: SchemaGraphData;
  node: SchemaGraphNode;
  onClose: () => void;
  onSelect: (key: string) => void;
  onNavigate: NavigateFunction;
}) {
  const key = nodeKey(node);
  const [columns, setColumns] = useState<{ name: string; type: string; in_key?: boolean }[]>([]);
  const [columnsError, setColumnsError] = useState(false);

  useEffect(() => {
    setColumns([]);
    setColumnsError(false);
    const controller = new AbortController();
    fetchColumns(node.database, node.name, controller.signal)
      .then((r) => setColumns(r.columns))
      .catch(() => setColumnsError(true));
    return () => controller.abort();
  }, [node.database, node.name]);

  const readsFrom = graph.edges.filter((e) => e.to === key).map((e) => e.from);
  const dependedOnBy = graph.edges.filter((e) => e.from === key).map((e) => e.to);

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded border border-[var(--color-border)] bg-[var(--surface-card)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] p-3">
        <div className="min-w-0">
          <p className="break-all font-mono text-sm font-medium text-[var(--color-text-primary)]">{key}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KIND_HUES[node.kind] }} />
              {KIND_LABELS[node.kind] ?? node.kind}
            </span>
            <Badge variant="secondary">{node.engine}</Badge>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-[var(--color-border)] p-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">Rows</p>
            <p className="font-mono text-sm">{formatNumber(node.total_rows)}</p>
          </div>
          <div className="rounded border border-[var(--color-border)] p-2">
            <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">Bytes</p>
            <p className="font-mono text-sm">{formatBytes(node.total_bytes)}</p>
          </div>
        </div>

        {node.sorting_key && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">Sorting key</p>
            <code className="block break-all rounded bg-[var(--surface-base)] p-2 font-mono text-[11px]">{node.sorting_key}</code>
          </div>
        )}
        {node.partition_key && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">Partition key</p>
            <code className="block break-all rounded bg-[var(--surface-base)] p-2 font-mono text-[11px]">{node.partition_key}</code>
          </div>
        )}
        {node.comment && (
          <p className="mt-3 rounded bg-[var(--surface-hover)] p-2 italic text-[var(--color-text-secondary)]">{node.comment}</p>
        )}

        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">Columns</p>
          {columnsError ? (
            <p className="text-[var(--color-text-secondary)]">Could not load columns.</p>
          ) : columns.length === 0 ? (
            <p className="text-[var(--color-text-secondary)]">Loading…</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)] rounded border border-[var(--color-border)]">
              {columns.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-[11px] text-[var(--color-text-primary)]">{c.name}</span>
                    {c.in_key && (
                      <span className="shrink-0 rounded bg-[var(--state-accent)] px-1 text-[9px] font-medium text-[var(--color-accent)]">key</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-secondary)]">{c.type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {readsFrom.length > 0 && (
          <DependencyList
            label="Reads from"
            items={readsFrom}
            onSelect={onSelect}
          />
        )}
        {dependedOnBy.length > 0 && (
          <DependencyList
            label="Depended on by"
            items={dependedOnBy}
            onSelect={onSelect}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] p-2">
        <DdlButton database={node.database} table={node.name} />
        <Button
          variant="ghost"
          onClick={() => sendToEditor(onNavigate, `SELECT *\nFROM ${node.database}.${node.name}\nLIMIT 100`, { origin: "schema-graph" })}
          title="Open a SELECT in the SQL Editor"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Query
        </Button>
        <Button
          variant="ghost"
          onClick={() => onNavigate(`/queries?database=${encodeURIComponent(node.database)}&table=${encodeURIComponent(node.name)}`)}
          title="Query history for this table"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Analysis
        </Button>
        {node.kind === "mergetree" && (
          <Button
            variant="ghost"
            onClick={() => onNavigate(`/optimizer/${encodeURIComponent(node.database)}/${encodeURIComponent(node.name)}`)}
            title="Analyze this table in the Optimizer"
          >
            <Wrench className="h-3.5 w-3.5" />
            Optimize
          </Button>
        )}
      </div>
    </aside>
  );
}

function DependencyList({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: string[];
  onSelect: (key: string) => void;
}) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">{label}</p>
      <ul className="space-y-1">
        {items.map((ref) => (
          <li key={ref}>
            <button
              type="button"
              onClick={() => onSelect(ref)}
              className="w-full break-all rounded px-2 py-1 text-left font-mono text-[11px] text-[var(--color-accent)] hover:bg-[var(--surface-hover)]"
            >
              {ref}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
