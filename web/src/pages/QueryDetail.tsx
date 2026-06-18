import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { Clock, MemoryStick, HardDrive, Database, Cpu, Layers, Fingerprint, Copy, ChevronRight as ChevronSep, Code } from "lucide-react";
import { useTheme } from "@/api/theme";
import { fetchQuery, fetchQueryMetrics, fetchQueryThreads, fetchQueryViews, fetchExplain, fetchFlameGraph } from "@/api/client";
import type { QueryLogEntry, MetricPoint, ThreadEntry, ViewLogEntry, ExplainResult, FlameGraphData } from "@/api/types";
import { ApiError } from "@/api/errors";
import { CardSkeleton } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { ErrorState, NotConnectedState } from "@/components/ui/state";
import { Badge } from "@/components/ui/badge";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { sendToEditor } from "@/lib/send-to-editor";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor, queryStatus } from "@/utils";
import { MetricCard } from "./query-detail/shared";
import { OverviewTab } from "./query-detail/OverviewTab";
import { MemoryTab } from "./query-detail/MemoryTab";
import { ThreadsTab } from "./query-detail/ThreadsTab";
import { StorageTab } from "./query-detail/StorageTab";
import { FlamegraphTab } from "./query-detail/FlamegraphTab";
import { ExplainTab } from "./query-detail/ExplainTab";
import { ViewsTab } from "./query-detail/ViewsTab";
import { SettingsTab } from "./query-detail/SettingsTab";

type Tab = "overview" | "memory" | "threads" | "storage" | "flamegraph" | "explain" | "views" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "memory", label: "Memory" },
  { key: "threads", label: "Threads" },
  { key: "storage", label: "Storage" },
  { key: "flamegraph", label: "Flamegraph" },
  { key: "explain", label: "Explain" },
  { key: "views", label: "Views" },
  { key: "settings", label: "Settings" },
];

export function QueryDetail({ connected }: { connected: boolean }) {
  const { queryId } = useParams<{ queryId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const theme = useTheme();
  const cmTheme = theme === "dark" ? oneDark : undefined;
  const copy = useCopyToClipboard();
  const [query, setQuery] = useState<QueryLogEntry | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [threads, setThreads] = useState<ThreadEntry[]>([]);
  const [views, setViews] = useState<ViewLogEntry[]>([]);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const initialTab = TABS.find((t) => t.key === searchParams.get("tab"))?.key ?? "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [flameError, setFlameError] = useState<ApiError | null>(null);
  const [flameData, setFlameData] = useState<FlameGraphData[]>([]);
  const [flameLoading, setFlameLoading] = useState(false);
  const [flameAttempted, setFlameAttempted] = useState(false);
  const [activeFlameType, setActiveFlameType] = useState<string>("Real");

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let aborted = false;
    if (!queryId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchQuery(queryId, controller.signal),
      fetchQueryMetrics(queryId, controller.signal).catch(() => []),
      fetchQueryThreads(queryId, controller.signal).catch(() => []),
      fetchQueryViews(queryId, controller.signal).catch(() => []),
      fetchExplain(queryId, controller.signal).catch(() => null),
    ]).then(([q, m, t, v, e]) => {
      if (aborted) return;
      setQuery(q);
      setMetrics(m || []);
      setThreads(t || []);
      setViews(v || []);
      if (e) setExplain(e);
    }).catch((e) => {
      if (aborted) return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    }).finally(() => {
      if (aborted) return;
      setLoading(false);
      setInitialLoad(false);
    });
    return () => { aborted = true; controller.abort(); };
  }, [queryId, connected]);

  const loadExplain = async () => {
    if (!queryId || explain) return;
    try {
      const e = await fetchExplain(queryId);
      setExplain(e);
    } catch {}
  };

  const loadFlameGraph = async () => {
    if (!queryId || flameData.length > 0) return;
    setFlameLoading(true);
    try {
      let data = await fetchFlameGraph(queryId);
      let foundType = "MemorySample";
      if (data.length === 0) {
        for (const altType of ["Memory", "MemoryPeak", "Real", "CPU"]) {
          data = await fetchFlameGraph(queryId, altType);
          if (data.length > 0) { foundType = altType; break; }
        }
      }
      setFlameData(data);
      setActiveFlameType(foundType);
      setFlameError(null);
    } catch (e) {
      setFlameError(ApiError.wrap(e));
    } finally {
      setFlameLoading(false);
      setFlameAttempted(true);
    }
  };

  const loadFlameGraphWithType = async (type: string) => {
    if (!queryId) return;
    setFlameData([]);
    setFlameLoading(true);
    setActiveFlameType(type);
    try {
      const data = await fetchFlameGraph(queryId, type);
      setFlameData(data);
      setFlameError(null);
    } catch (e) {
      setFlameError(ApiError.wrap(e));
    } finally {
      setFlameLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "flamegraph" && queryId && flameData.length === 0 && !flameLoading) {
      loadFlameGraph();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId, tab]);

  if (!connected) {
    return <NotConnectedState />;
  }

  if (loading && initialLoad) {
    return (
      <PageContainer>
        <div className="mb-2 flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
          <Link to="/queries" className="hover:text-[var(--color-accent)]">Queries</Link>
          <ChevronSep className="h-3 w-3" />
          <span>Loading...</span>
        </div>
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <CardSkeleton />
      </PageContainer>
    );
  }

  if (error || (!query && !loading)) {
    return (
      <PageContainer>
        <ErrorState
          error={error || "Query not found"}
          onRetry={() => window.location.reload()}
        />
      </PageContainer>
    );
  }

  if (!query) {
    return null;
  }

  return (
    <PageContainer>
      <div className="mb-2 flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <Link to="/queries" className="hover:text-[var(--color-accent)]">Queries</Link>
        <ChevronSep className="h-3 w-3" />
        <span className="font-mono">{query.query_id.slice(0, 16)}...</span>
      </div>

      <PageHeader
        title="Query Detail"
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-normal">
            <span className="font-mono">{query.query_id}</span>
            <span>{formatTime(query.query_start_time)}</span>
            <span>{query.user}</span>
            <Badge variant={queryStatus(query.type).variant} className="text-[10px]">{queryStatus(query.type).label}</Badge>
            <Link
              to={`/fingerprints/${query.normalized_query_hash}`}
              state={{ query: query.query }}
              className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
            >
              <Fingerprint className="h-3.5 w-3.5" />
              Fingerprint
            </Link>
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <MetricCard icon={<Clock className="h-4 w-4" />} label="Duration" value={formatDuration(query.query_duration_ms)} color={durationColor(query.query_duration_ms)} />
        <MetricCard icon={<MemoryStick className="h-4 w-4" />} label="Peak Memory" value={formatBytes(query.memory_usage)} color={memoryColor(query.memory_usage)} />
        <MetricCard icon={<Database className="h-4 w-4" />} label="Rows Read" value={formatNumber(query.read_rows)} />
        <MetricCard icon={<HardDrive className="h-4 w-4" />} label="Data Read" value={formatBytes(query.read_bytes)} />
        <MetricCard icon={<Layers className="h-4 w-4" />} label="Result Rows" value={formatNumber(query.result_rows)} />
        <MetricCard icon={<Cpu className="h-4 w-4" />} label="Threads" value={String(query.peak_threads_usage)} />
      </div>

      {query.exception && (
        <div className="mb-6 rounded-lg border border-[var(--color-error)]/30 bg-[var(--state-error)] p-4">
          <p className="text-sm font-medium text-[var(--color-error)]">Exception (code {query.exception_code})</p>
          <p className="mt-1 font-mono text-xs text-[var(--color-error)] opacity-80">{query.exception}</p>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">Query</div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => sendToEditor(navigate, query.query, { origin: "query-detail" })}
              title="Open in Editor"
            >
              <Code className="h-3.5 w-3.5" />
              <span className="ml-1 hidden sm:inline">Open in Editor</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => copy(query.query, "Query copied!")}
              title="Copy query"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CodeMirror
          value={query.query}
          extensions={[sql()]}
          theme={cmTheme}
          readOnly={true}
          editable={false}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
          className="text-xs [&_.cm-editor]:max-h-40 [&_.cm-editor]:overflow-auto [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs"
        />
      </div>

      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSearchParams((prev) => {
                if (t.key === "overview") prev.delete("tab");
                else prev.set("tab", t.key);
                return prev;
              }, { replace: true });
              if (t.key === "explain") loadExplain();
              if (t.key === "flamegraph") loadFlameGraph();
            }}
            className={`px-4 py-2 text-sm capitalize transition-colors ${
              tab === t.key
                ? "border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab query={query} metrics={metrics} />}
      {tab === "memory" && <MemoryTab query={query} metrics={metrics} />}
      {tab === "threads" && <ThreadsTab queryId={query.query_id} threads={threads} pipelineStr={explain?.pipeline} querySettings={query.settings} />}
      {tab === "storage" && <StorageTab events={query.profile_events} />}
      {tab === "flamegraph" && (
        <FlamegraphTab
          flameData={flameData}
          flameError={flameError}
          flameLoading={flameLoading}
          flameAttempted={flameAttempted}
          query={query}
          onSelectType={loadFlameGraphWithType}
          activeType={activeFlameType}
        />
      )}
      {tab === "explain" && <ExplainTab explain={explain} />}
      {tab === "views" && <ViewsTab views={views} />}
      {tab === "settings" && <SettingsTab settings={query.settings} />}
    </PageContainer>
  );
}
