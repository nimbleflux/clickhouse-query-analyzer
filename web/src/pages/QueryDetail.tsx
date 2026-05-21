import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { Clock, MemoryStick, HardDrive, Database, Cpu, Play, Layers, Eye, Cloud, ChevronDown, ChevronRight } from "lucide-react";
import { fetchQuery, fetchQueryMetrics, fetchQueryThreads, fetchQueryViews, fetchExplain, fetchFlameGraph, fetchThreadSummaries, fetchThreadProfile } from "../api/client";
import type { QueryLogEntry, MetricPoint, ThreadEntry, ViewLogEntry, ExplainResult, FlameGraphData, ThreadSummary, ThreadProfile } from "../api/types";
import { FlameGraph } from "../components/FlameGraph";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor, categorizeEvent } from "../utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tooltipFmt(fn: (v: number) => string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (value: any) => fn(Number(value));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelFmt(fn: (l: string) => string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (label: any) => fn(String(label));
}

type Tab = "overview" | "memory" | "threads" | "storage" | "flamegraph" | "explain" | "views" | "settings";

export function QueryDetail() {
  const { queryId } = useParams<{ queryId: string }>();
  const [query, setQuery] = useState<QueryLogEntry | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [threads, setThreads] = useState<ThreadEntry[]>([]);
  const [views, setViews] = useState<ViewLogEntry[]>([]);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flameData, setFlameData] = useState<FlameGraphData[]>([]);
  const [profileEventFilter, setProfileEventFilter] = useState("");

  const load = useCallback(async () => {
    if (!queryId) return;
    setLoading(true);
    setError("");
    try {
      const [q, m, t, v, e] = await Promise.all([
        fetchQuery(queryId),
        fetchQueryMetrics(queryId).catch(() => []),
        fetchQueryThreads(queryId).catch(() => []),
        fetchQueryViews(queryId).catch(() => []),
        fetchExplain(queryId).catch(() => null),
      ]);
      setQuery(q);
      setMetrics(m || []);
      setThreads(t || []);
      setViews(v || []);
      if (e) setExplain(e);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load query");
    } finally {
      setLoading(false);
    }
  }, [queryId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadExplain = async () => {
    if (!queryId || explain) return;
    try {
      const e = await fetchExplain(queryId);
      setExplain(e);
    } catch {}
  };

  const loadFlameGraph = async () => {
    if (!queryId || flameData.length > 0) return;
    try {
      const data = await fetchFlameGraph(queryId);
      setFlameData(data);
    } catch {}
  };

  const loadFlameGraphWithType = async (type: string) => {
    if (!queryId) return;
    try {
      const data = await fetchFlameGraph(queryId, type);
      setFlameData(data);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--color-text-secondary)]">
        Loading query details...
      </div>
    );
  }

  if (error || !query) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 text-center">
        <p className="text-[var(--color-error)]">{error || "Query not found"}</p>
      </div>
    );
  }

  const metricData = computeMetricDeltas(metrics);
  const topEvents = getTopProfileEvents(query.profile_events);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="mb-2 text-xl font-bold">Query Detail</h1>
        <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
          <span className="font-mono">{query.query_id}</span>
          <span>{formatTime(query.query_start_time)}</span>
          <span>{query.user}</span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <MetricCard icon={<Clock className="h-4 w-4" />} label="Duration" value={formatDuration(query.query_duration_ms)} color={durationColor(query.query_duration_ms)} />
        <MetricCard icon={<MemoryStick className="h-4 w-4" />} label="Peak Memory" value={formatBytes(query.memory_usage)} color={memoryColor(query.memory_usage)} />
        <MetricCard icon={<Database className="h-4 w-4" />} label="Rows Read" value={formatNumber(query.read_rows)} />
        <MetricCard icon={<HardDrive className="h-4 w-4" />} label="Data Read" value={formatBytes(query.read_bytes)} />
        <MetricCard icon={<Layers className="h-4 w-4" />} label="Result Rows" value={formatNumber(query.result_rows)} />
        <MetricCard icon={<Cpu className="h-4 w-4" />} label="Threads" value={String(query.peak_threads_usage)} />
      </div>

      {query.exception && (
        <div className="mb-6 rounded-lg border border-[var(--color-error)] bg-red-900/20 p-4">
          <p className="text-sm font-medium text-[var(--color-error)]">Exception (code {query.exception_code})</p>
          <p className="mt-1 font-mono text-xs text-red-300">{query.exception}</p>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Query</div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-text-primary)]">
          {query.query}
        </pre>
      </div>

      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {(["overview", "memory", "threads", "storage", "flamegraph", "explain", "views", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "explain") loadExplain();
              if (t === "flamegraph") loadFlameGraph();
            }}
            className={`px-4 py-2 text-sm capitalize ${
              tab === t
                ? "border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          {metricData.length > 1 ? (
            <>
              <ChartSection title="Memory Usage Over Time">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={metricData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="#64748b" width={80} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={labelFmt((l) => `Time: ${l}`)}
                      formatter={tooltipFmt(formatBytes)}
                    />
                    <Area type="monotone" dataKey="memory" stroke="#3b82f6" fill="#3b82f680" name="Memory" />
                    <Area type="monotone" dataKey="peak" stroke="#8b5cf6" fill="#8b5cf640" name="Peak" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartSection>

              <ChartSection title="CPU Time Over Time">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={metricData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tickFormatter={(v: number) => formatDuration(v / 1000)} tick={{ fontSize: 11 }} stroke="#64748b" width={80} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={labelFmt((l) => `Time: ${l}`)}
                      formatter={tooltipFmt((v) => formatDuration(v / 1000))}
                    />
                    <Area type="monotone" dataKey="userTime" stroke="#22c55e" fill="#22c55e40" name="User CPU" />
                    <Area type="monotone" dataKey="systemTime" stroke="#f59e0b" fill="#f59e0b40" name="System CPU" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartSection>

              <ChartSection title="I/O Over Time">
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={metricData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="#64748b" width={80} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={labelFmt((l) => `Time: ${l}`)}
                      formatter={tooltipFmt(formatBytes)}
                    />
                    <Area type="monotone" dataKey="readBytes" stroke="#3b82f6" fill="#3b82f640" name="Disk Read" />
                    <Area type="monotone" dataKey="writeBytes" stroke="#ef4444" fill="#ef444440" name="Disk Write" />
                    <Legend />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartSection>

              <ChartSection title="Network Over Time">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={metricData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                    <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="#64748b" width={80} />
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={labelFmt((l) => `Time: ${l}`)}
                      formatter={tooltipFmt(formatBytes)}
                    />
                    <Line type="monotone" dataKey="netRecv" stroke="#22c55e" name="Received" dot={false} />
                    <Line type="monotone" dataKey="netSend" stroke="#8b5cf6" name="Sent" dot={false} />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </ChartSection>
            </>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
              No time-series metric data available for this query.
              <br />
              <span className="text-xs">This may be because query_metric_log is not enabled or the query was too fast to sample.</span>
            </div>
          )}

          {topEvents.length > 0 && (
            <ChartSection title="Top Profile Events">
              <div className="mb-2">
                <input
                  type="text"
                  value={profileEventFilter}
                  onChange={(e) => setProfileEventFilter(e.target.value)}
                  placeholder="Filter events..."
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                      <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Event</th>
                      <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Value</th>
                      <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEvents
                      .filter(([name]) => !profileEventFilter || name.toLowerCase().includes(profileEventFilter.toLowerCase()))
                      .map(([name, value, cat]) => (
                      <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="px-4 py-2 font-mono text-xs">{name}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(value)}</td>
                        <td className="px-4 py-2 text-right text-xs text-[var(--color-text-secondary)]">{cat}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartSection>
          )}
        </div>
      )}

      {tab === "threads" && (
        <ThreadBreakdownTab queryId={query.query_id} threads={threads} pipelineStr={explain?.pipeline} />
      )}

      {tab === "memory" && (
        <MemoryTab query={query} metrics={metrics} />
      )}

      {tab === "storage" && (
        <StorageTab events={query.profile_events} />
      )}

      {tab === "flamegraph" && (
        <ChartSection title="Flame Graph">
          <div className="mb-3 flex gap-2">
            {(["MemorySample", "Memory", "MemoryPeak"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setFlameData([]); loadFlameGraphWithType(t); }}
                className="rounded border border-[var(--color-border)] px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--color-bg-tertiary)]"
              >
                {t === "MemorySample" ? "Memory (Sampled)" : t === "Memory" ? "Memory (Alloc)" : "Memory (Peak)"}
              </button>
            ))}
          </div>
          {flameData.length === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
              <p>No trace data available for this query.</p>
              <p className="mt-1 text-xs opacity-70">
                Trace data requires the query to have been executed while sampling profilers were enabled.
                Try running a heavy query in the SQL editor, e.g.:
              </p>
              <pre className="mt-2 inline-block rounded bg-[var(--color-bg-primary)] px-3 py-2 text-left font-mono text-xs text-[var(--color-text-primary)]">
                SELECT count() FROM analytics.events GROUP BY city, browser, device
              </pre>
            </div>
          ) : (
            <FlameGraph data={flameData} />
          )}
        </ChartSection>
      )}

      {tab === "explain" && (
        <div className="space-y-4">
          {explain ? (
            ["plan", "pipeline", "syntax"].map((type) => {
              const content = explain[type as keyof ExplainResult];
              if (!content) return null;
              return (
                <div key={type} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                  <div className="mb-2 text-xs font-medium capitalize text-[var(--color-text-secondary)]">
                    {type === "plan" ? "Execution Plan" : type === "pipeline" ? "Query Pipeline" : "Normalized Syntax"}
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-text-primary)]">
                    {content}
                  </pre>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-4 py-12">
              <Play className="h-8 w-8 text-[var(--color-text-secondary)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">
                Click "explain" tab to run EXPLAIN on this query
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "views" && (
        <div className="space-y-4">
          {views.length > 0 ? (
            views.map((v, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-[var(--color-accent)]" />
                    <span className="font-medium">{v.view_name}</span>
                    <span className="rounded bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]">
                      {v.view_type}
                    </span>
                  </div>
                  <span className="text-sm text-[var(--color-text-secondary)]">{formatDuration(v.view_duration_ms)}</span>
                </div>
                <pre className="mb-2 max-h-24 overflow-auto font-mono text-xs text-[var(--color-text-secondary)]">{v.view_query}</pre>
                <div className="flex gap-6 text-xs text-[var(--color-text-secondary)]">
                  <span>Rows: {formatNumber(v.read_rows)} read / {formatNumber(v.written_rows)} written</span>
                  <span>Memory: {formatBytes(v.peak_memory_usage)}</span>
                  {v.exception && <span className="text-[var(--color-error)]">{v.exception}</span>}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
              No views were triggered by this query.
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Setting</th>
                <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(query.settings || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                <tr key={k} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{k}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-accent)]">{v}</td>
                </tr>
              ))}
              {Object.keys(query.settings || {}).length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-[var(--color-text-secondary)]">
                    No settings recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StorageTab({ events }: { events: Record<string, number> }) {
  const storageEvents = extractStorageEvents(events);
  const hasData = [
    storageEvents.apiOps,
    storageEvents.readWrite,
    storageEvents.throughput,
    storageEvents.throttlers,
    storageEvents.remoteFs,
    storageEvents.cache,
  ].some((arr) => arr.length > 0);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <Cloud className="h-10 w-10 text-[var(--color-text-secondary)]" />
        <p className="text-sm text-[var(--color-text-secondary)]">No remote storage interactions detected for this query.</p>
        <p className="max-w-md text-center text-xs text-[var(--color-text-secondary)]">
          This tab shows S3, Azure, and other remote storage metrics when the query reads from or writes to
          external storage (S3 tables, URL engine, DiskS3, DiskAzure, etc.).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {storageEvents.apiOps.length > 0 && (
        <ChartSection title="API Operations">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={storageEvents.apiOps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#64748b" interval={0} angle={-30} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="s3" fill="#3b82f6" name="S3" />
              <Bar dataKey="diskS3" fill="#60a5fa" name="DiskS3" />
              <Bar dataKey="azure" fill="#f59e0b" name="Azure" />
              <Bar dataKey="diskAzure" fill="#fbbf24" name="DiskAzure" />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {storageEvents.readWrite.length > 0 && (
        <ChartSection title="Read/Write Requests">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Requests</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Time</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Errors</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Throttled</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Retries</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.readWrite.map((rw) => (
                  <tr key={rw.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{rw.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(rw.count)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{rw.timeUs > 0 ? formatDuration(rw.timeUs / 1000) : "-"}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${rw.errors > 0 ? "text-[var(--color-error)]" : ""}`}>
                      {rw.errors > 0 ? rw.errors : "-"}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${rw.throttled > 0 ? "text-[var(--color-warning)]" : ""}`}>
                      {rw.throttled > 0 ? rw.throttled : "-"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{rw.retries > 0 ? rw.retries : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.throughput.length > 0 && (
        <ChartSection title="Throughput">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Source</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Bytes Read</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Bytes Written</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Read Time</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Write Time</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.throughput.map((tp) => (
                  <tr key={tp.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{tp.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.readBytes > 0 ? formatBytes(tp.readBytes) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.writeBytes > 0 ? formatBytes(tp.writeBytes) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.readTimeUs > 0 ? formatDuration(tp.readTimeUs / 1000) : "-"}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{tp.writeTimeUs > 0 ? formatDuration(tp.writeTimeUs / 1000) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.throttlers.length > 0 && (
        <ChartSection title="Throttling">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Throttler</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Passed</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Blocked</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Sleep Time</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.throttlers.map((th) => (
                  <tr key={th.label} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs font-medium">{th.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(th.count)}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${th.blocked > 0 ? "text-[var(--color-warning)]" : ""}`}>
                      {th.blocked}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {th.sleepUs > 0 ? formatDuration(th.sleepUs / 1000) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}

      {storageEvents.remoteFs.length > 0 && (
        <ChartSection title="Remote Filesystem / Prefetch">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={storageEvents.remoteFs} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 10 }} stroke="#64748b" />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {storageEvents.cache.length > 0 && (
        <ChartSection title="Filesystem Cache">
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Value</th>
                </tr>
              </thead>
              <tbody>
                {storageEvents.cache.map(([name, value]) => (
                  <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 text-xs">{name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {name.toLowerCase().includes("bytes") ? formatBytes(value) :
                       name.toLowerCase().includes("microseconds") ? formatDuration(value / 1000) :
                       formatNumber(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}
    </div>
  );
}

interface StorageReadWrite {
  label: string;
  count: number;
  timeUs: number;
  errors: number;
  throttled: number;
  retries: number;
}

interface StorageThroughput {
  label: string;
  readBytes: number;
  writeBytes: number;
  readTimeUs: number;
  writeTimeUs: number;
}

interface StorageThrottler {
  label: string;
  count: number;
  blocked: number;
  sleepUs: number;
}

interface StorageExtracted {
  apiOps: { name: string; s3: number; diskS3: number; azure: number; diskAzure: number }[];
  readWrite: StorageReadWrite[];
  throughput: StorageThroughput[];
  throttlers: StorageThrottler[];
  remoteFs: { name: string; value: number }[];
  cache: [string, number][];
}

const S3_API_OPS = [
  "GetObject", "PutObject", "DeleteObjects", "ListObjects", "HeadObject",
  "CopyObject", "GetObjectTagging", "CreateMultipartUpload", "UploadPart",
  "UploadPartCopy", "CompleteMultipartUpload", "AbortMultipartUpload",
];

const AZURE_API_OPS = [
  "GetObject", "Upload", "StageBlock", "CommitBlockList", "CopyObject",
  "DeleteObjects", "ListObjects", "GetProperties", "CreateContainer",
];

function getVal(events: Record<string, number>, key: string): number {
  return events[key] || 0;
}

function extractStorageEvents(events: Record<string, number>): StorageExtracted {
  const apiOpsMap = new Map<string, { s3: number; diskS3: number; azure: number; diskAzure: number }>();

  for (const op of S3_API_OPS) {
    const s3 = getVal(events, `S3${op}`);
    const diskS3 = getVal(events, `DiskS3${op}`);
    if (s3 > 0 || diskS3 > 0) apiOpsMap.set(op, { ...(apiOpsMap.get(op) || { s3: 0, diskS3: 0, azure: 0, diskAzure: 0 }), s3, diskS3 });
  }
  for (const op of AZURE_API_OPS) {
    const azure = getVal(events, `Azure${op}`);
    const diskAzure = getVal(events, `DiskAzure${op}`);
    if (azure > 0 || diskAzure > 0) apiOpsMap.set(op, { ...(apiOpsMap.get(op) || { s3: 0, diskS3: 0, azure: 0, diskAzure: 0 }), azure, diskAzure });
  }

  const apiOps = Array.from(apiOpsMap.entries())
    .map(([name, vals]) => ({ name, ...vals }))
    .filter((r) => r.s3 + r.diskS3 + r.azure + r.diskAzure > 0);

  const readWrite: StorageReadWrite[] = [];
  for (const [prefix, label] of [["S3", "S3"], ["DiskS3", "DiskS3"], ["Azure", "Azure"], ["DiskAzure", "DiskAzure"]] as [string, string][]) {
    const rc = getVal(events, `${prefix}ReadRequestsCount`);
    const wc = getVal(events, `${prefix}WriteRequestsCount`);
    if (rc > 0 || wc > 0) {
      readWrite.push({
        label,
        count: rc + wc,
        timeUs: getVal(events, `${prefix}ReadMicroseconds`) + getVal(events, `${prefix}WriteMicroseconds`),
        errors: getVal(events, `${prefix}ReadRequestsErrors`) + getVal(events, `${prefix}WriteRequestsErrors`),
        throttled: getVal(events, `${prefix}ReadRequestsThrottling`) + getVal(events, `${prefix}WriteRequestsThrottling`),
        retries: getVal(events, `${prefix}ReadRequestRetryableErrors`) + getVal(events, `${prefix}WriteRequestRetryableErrors`),
      });
    }
  }

  const throughput: StorageThroughput[] = [];
  for (const [prefix, label] of [["S3", "S3"], ["Azure", "Azure"]] as [string, string][]) {
    const rb = getVal(events, `ReadBufferFrom${prefix}Bytes`);
    const wb = getVal(events, `WriteBufferFrom${prefix}Bytes`);
    const rt = getVal(events, `ReadBufferFrom${prefix}Microseconds`);
    const wt = getVal(events, `WriteBufferFrom${prefix}Microseconds`);
    if (rb > 0 || wb > 0 || rt > 0 || wt > 0) {
      throughput.push({ label, readBytes: rb, writeBytes: wb, readTimeUs: rt, writeTimeUs: wt });
    }
  }

  const throttlers: StorageThrottler[] = [];
  for (const [prefix, label] of [
    ["S3GetRequest", "S3 GET"], ["S3PutRequest", "S3 PUT"],
    ["DiskS3GetRequest", "DiskS3 GET"], ["DiskS3PutRequest", "DiskS3 PUT"],
    ["AzureGetRequest", "Azure GET"], ["AzurePutRequest", "Azure PUT"],
    ["DiskAzureGetRequest", "DiskAzure GET"], ["DiskAzurePutRequest", "DiskAzure PUT"],
    ["RemoteRead", "Remote Read"], ["RemoteWrite", "Remote Write"],
    ["QueryRemoteRead", "Query Remote Read"], ["QueryRemoteWrite", "Query Remote Write"],
  ] as [string, string][]) {
    const count = getVal(events, `${prefix}ThrottlerCount`);
    const blocked = getVal(events, `${prefix}ThrottlerBlocked`);
    const sleepUs = getVal(events, `${prefix}ThrottlerSleepMicroseconds`);
    if (count > 0 || blocked > 0 || sleepUs > 0) {
      throttlers.push({ label, count, blocked, sleepUs });
    }
  }

  const remoteFsKeys = [
    "RemoteFSSeeks", "RemoteFSPrefetches", "RemoteFSCancelledPrefetches",
    "RemoteFSUnusedPrefetches", "RemoteFSPrefetchedReads", "RemoteFSPrefetchedBytes",
    "RemoteFSUnprefetchedReads", "RemoteFSUnprefetchedBytes", "RemoteFSLazySeeks",
    "RemoteFSSeeksWithReset", "RemoteFSBuffers",
  ];
  const remoteFs = remoteFsKeys
    .map((k) => ({ name: k.replace("RemoteFS", ""), value: getVal(events, k) }))
    .filter((r) => r.value > 0);

  const cacheKeys = [
    "CachedReadBufferReadFromCacheHits", "CachedReadBufferReadFromCacheMisses",
    "CachedReadBufferReadFromSourceMicroseconds", "CachedReadBufferReadFromCacheMicroseconds",
    "CachedReadBufferReadFromSourceBytes", "CachedReadBufferReadFromCacheBytes",
    "CachedReadBufferCacheWriteBytes", "CachedReadBufferCacheWriteMicroseconds",
    "CachedWriteBufferCacheWriteBytes", "CachedWriteBufferCacheWriteMicroseconds",
  ];
  const cache = cacheKeys
    .map((k) => [k, getVal(events, k)] as [string, number])
    .filter(([, v]) => v > 0);

  return { apiOps, readWrite, throughput, throttlers, remoteFs, cache };
}

function parsePipeline(pipelineStr: string): { name: string; count: number }[] {
  const steps: { name: string; count: number }[] = [];
  const seen = new Set<string>();
  for (const line of pipelineStr.split("\n")) {
    const trimmed = line.replace(/[()×→\d\s]+/g, " ").trim();
    const match = trimmed.match(/^(?:\((\w+)\)\s*)?(\w+)(?:\s.*×(\d+))?/);
    if (!match) continue;
    const stepName = match[1] || match[2];
    const count = match[3] ? parseInt(match[3]) : 1;
    const key = stepName;
    if (!seen.has(key)) {
      seen.add(key);
      steps.push({ name: stepName, count });
    }
  }
  return steps;
}

const KEY_PROFILE_EVENTS: [string, string, (v: number) => string][] = [
  ["SelectedRows", "Rows Selected", (v) => formatNumber(v)],
  ["RowsReadByMainReader", "Rows Read (Main)", (v) => formatNumber(v)],
  ["FilterTransformPassedRows", "Rows Passed Filter", (v) => formatNumber(v)],
  ["ReadCompressedBytes", "Compressed Read", (v) => formatBytes(v)],
  ["CompressedReadBufferBytes", "Decompressed Bytes", (v) => formatBytes(v)],
  ["DiskReadElapsedMicroseconds", "Disk Read Time", (v) => formatDuration(v / 1000)],
  ["SynchronousReadWaitMicroseconds", "Sync Read Wait", (v) => formatDuration(v / 1000)],
  ["IOBufferAllocBytes", "I/O Buffer Alloc", (v) => formatBytes(v)],
  ["ArenaAllocBytes", "Arena Alloc", (v) => formatBytes(v)],
  ["UserTimeMicroseconds", "User CPU Time", (v) => formatDuration(v / 1000)],
  ["SystemTimeMicroseconds", "System CPU Time", (v) => formatDuration(v / 1000)],
  ["RealTimeMicroseconds", "Wall Clock Time", (v) => formatDuration(v / 1000)],
  ["OSCPUWaitMicroseconds", "CPU Wait", (v) => formatDuration(v / 1000)],
  ["NetworkSendBytes", "Network Sent", (v) => formatBytes(v)],
  ["MarkCacheHits", "Mark Cache Hits", (v) => formatNumber(v)],
  ["MarkCacheMisses", "Mark Cache Misses", (v) => formatNumber(v)],
  ["CreatedReadBufferOrdinary", "Read Buffers Created", (v) => v.toString()],
  ["FileOpen", "Files Opened", (v) => v.toString()],
  ["QueryPlanOptimizeMicroseconds", "Plan Optimization", (v) => formatDuration(v / 1000)],
];

function ThreadDetailPanel({ profile, loading, showAllEvents, onToggleEvents }: {
  profile: ThreadProfile | null;
  loading: boolean;
  showAllEvents: boolean;
  onToggleEvents: () => void;
}) {
  if (loading) {
    return <div className="bg-[var(--color-bg-tertiary)] px-6 py-4 text-xs text-[var(--color-text-secondary)]">Loading thread profile...</div>;
  }
  if (!profile) {
    return <div className="bg-[var(--color-bg-tertiary)] px-6 py-4 text-xs text-[var(--color-text-secondary)]">Failed to load thread profile.</div>;
  }

  const selectivity = profile.profile_events["SelectedRows"] > 0 && profile.profile_events["FilterTransformPassedRows"] > 0
    ? ((profile.profile_events["FilterTransformPassedRows"] / profile.profile_events["SelectedRows"]) * 100).toFixed(1)
    : null;

  return (
    <div className="space-y-4 bg-[var(--color-bg-tertiary)] px-6 py-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Peak Memory</div>
          <div className="text-sm font-bold">{formatBytes(profile.peak_memory_usage)}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Read</div>
          <div className="text-sm font-bold">{formatNumber(profile.read_rows)} rows</div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">{formatBytes(profile.read_bytes)}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">CPU User / Sys</div>
          <div className="text-sm font-bold">
            {formatDuration((profile.profile_events["UserTimeMicroseconds"] || 0) / 1000)} / {formatDuration((profile.profile_events["SystemTimeMicroseconds"] || 0) / 1000)}
          </div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Wall Clock</div>
          <div className="text-sm font-bold">{formatDuration(profile.duration_ms)}</div>
        </div>
      </div>

      {selectivity !== null && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Filter Selectivity</div>
          <div className="flex items-center gap-3">
            <div className="text-sm font-bold">{selectivity}% passed</div>
            <div className="flex-1">
              <div className="h-2 rounded-full bg-[var(--color-bg-tertiary)]">
                <div className="h-2 rounded-full bg-green-500" style={{ width: `${selectivity}%` }} />
              </div>
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">
              {formatNumber(profile.profile_events["FilterTransformPassedRows"])} / {formatNumber(profile.profile_events["SelectedRows"])} rows
            </div>
          </div>
        </div>
      )}

      {profile.top_functions.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-medium text-[var(--color-text-secondary)]">
            Top Functions ({formatNumber(profile.total_samples)} trace samples)
          </div>
          <div className="max-h-48 overflow-auto rounded border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  <th className="px-3 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)]">%</th>
                  <th className="px-3 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)]">Samples</th>
                  <th className="px-3 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)]">Function</th>
                </tr>
              </thead>
              <tbody>
                {profile.top_functions.map((f, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-1 font-mono">
                      <div className="flex items-center gap-2">
                        <div className="w-12 rounded bg-[var(--color-bg-secondary)]">
                          <div className="h-1.5 rounded bg-purple-500" style={{ width: `${Math.min(f.percent, 100)}%` }} />
                        </div>
                        <span className="text-[var(--color-text-secondary)]">{f.percent.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-1 font-mono text-[var(--color-text-secondary)]">{formatNumber(f.samples)}</td>
                    <td className="px-3 py-1 font-mono">{f.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <button onClick={onToggleEvents} className="flex items-center gap-1 text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          {showAllEvents ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          All Profile Events ({Object.keys(profile.profile_events).length})
        </button>
        {showAllEvents && (
          <div className="mt-2 grid grid-cols-3 gap-x-6 gap-y-0.5">
            {Object.entries(profile.profile_events)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex justify-between text-[10px]">
                  <span className="text-[var(--color-text-secondary)]">{k}</span>
                  <span className="font-mono">{formatNumber(v)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium text-[var(--color-text-secondary)]">Key Metrics</div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          {KEY_PROFILE_EVENTS.map(([key, label, fmt]) => {
            const val = profile.profile_events[key];
            if (!val) return null;
            return (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="text-[var(--color-text-secondary)]">{label}</span>
                <span className="font-mono">{fmt(val)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ThreadBreakdownTab({ queryId, threads, pipelineStr }: { queryId: string; threads: ThreadEntry[]; pipelineStr?: string }) {
  const [threadSummaries, setThreadSummaries] = useState<ThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<number | null>(null);
  const [threadProfile, setThreadProfile] = useState<ThreadProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);

  useEffect(() => {
    if (threads.length === 0) return;
    fetchThreadSummaries(queryId).then(setThreadSummaries).catch(() => {});
  }, [threads.length, queryId]);

  useEffect(() => {
    if (selectedThread === null) { setThreadProfile(null); return; }
    setProfileLoading(true);
    fetchThreadProfile(queryId, selectedThread)
      .then(setThreadProfile)
      .catch(() => setThreadProfile(null))
      .finally(() => setProfileLoading(false));
  }, [selectedThread, queryId]);

  const pipelineSteps = pipelineStr ? parsePipeline(pipelineStr) : [];

  const roleColor = (role: string) => {
    switch (role) {
      case "Coordinator": return "bg-blue-500/20 text-blue-400";
      case "Scan + Filter": return "bg-green-500/20 text-green-400";
      case "Table Scanner": return "bg-green-500/20 text-green-400";
      case "Reader": return "bg-green-500/20 text-green-400";
      case "Aggregator": return "bg-purple-500/20 text-purple-400";
      case "Filter": return "bg-yellow-500/20 text-yellow-400";
      case "I/O Pool": return "bg-orange-500/20 text-orange-400";
      case "Pipeline Manager": return "bg-cyan-500/20 text-cyan-400";
      default: return "bg-gray-500/20 text-gray-400";
    }
  };

  if (threadSummaries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
        No thread data available for this query. This can happen if log_query_threads is not enabled or the query was too fast.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pipelineSteps.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Execution Pipeline</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {pipelineSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-bg-tertiary)] px-2 py-1 text-xs font-mono">
                  {step.name}
                  {step.count > 1 && <span className="text-[var(--color-text-secondary)]">x{step.count}</span>}
                </span>
                {i < pipelineSteps.length - 1 && <span className="text-[var(--color-text-secondary)]">&rarr;</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <ChartSection title="Thread Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">Thread</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">Role</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Peak Mem</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Read Rows</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Read Bytes</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">CPU Time</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">I/O Wait</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Duration</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Filter</th>
              </tr>
            </thead>
            <tbody>
              {threadSummaries.map((t) => {
                const isSelected = selectedThread === t.thread_id;
                const cpuUs = (t.user_time_us || 0) + (t.system_time_us || 0);
                const selectivity = t.filter_total_rows > 0
                  ? `${((t.filter_passed_rows / t.filter_total_rows) * 100).toFixed(0)}%`
                  : "-";
                return (
                  <>
                    <tr
                      key={t.thread_id}
                      onClick={() => setSelectedThread(isSelected ? null : t.thread_id)}
                      className="cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                    >
                      <td className="px-3 py-2 text-xs font-mono">
                        <span className="inline-flex items-center gap-1">
                          {isSelected ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          #{t.thread_id} {t.thread_name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${roleColor(t.role)}`}>{t.role}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatBytes(t.peak_memory_usage)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.read_rows > 0 ? formatNumber(t.read_rows) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.read_bytes > 0 ? formatBytes(t.read_bytes) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{cpuUs > 0 ? formatDuration(cpuUs / 1000) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.disk_read_us > 0 ? formatDuration(t.disk_read_us / 1000) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatDuration(t.query_duration_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]">{selectivity}</td>
                    </tr>
                    {isSelected && (
                      <tr key={`${t.thread_id}-detail`}>
                        <td colSpan={9} className="border-b border-[var(--color-border)] p-0">
                          <ThreadDetailPanel profile={threadProfile} loading={profileLoading} showAllEvents={showAllEvents} onToggleEvents={() => setShowAllEvents(!showAllEvents)} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartSection>
    </div>
  );
}

function MemoryTab({ query, metrics }: { query: QueryLogEntry; metrics: MetricPoint[] }) {
  const memCategories = extractMemoryCategories(query.profile_events);

  const memOverTime = metrics.length > 1
    ? metrics.map((m) => ({
        time: new Date(m.event_time).toLocaleTimeString(),
        memory: m.memory_usage,
        peak: m.peak_memory_usage,
      }))
    : [];

  const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#ec4899", "#f97316"];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-secondary)]">Peak Memory Usage</div>
          <div className={`text-2xl font-bold ${memoryColor(query.memory_usage)}`}>
            {formatBytes(query.memory_usage)}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-secondary)]">Data Read into Memory</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatBytes(query.read_bytes)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {formatNumber(query.read_rows)} rows
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-secondary)]">Memory Profile</div>
          <div className="text-sm text-[var(--color-text-primary)]">
            {memCategories.length > 0 ? `${memCategories.length} categories` : "No categories"}
          </div>
        </div>
      </div>

      {memOverTime.length > 1 && (
        <ChartSection title="Memory Usage Over Time">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={memOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
              <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="#64748b" width={80} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                formatter={tooltipFmt(formatBytes)}
              />
              <Area type="monotone" dataKey="memory" stroke="#3b82f6" fill="#3b82f680" name="Current" />
              <Area type="monotone" dataKey="peak" stroke="#8b5cf6" fill="#8b5cf640" name="Peak" />
              <Legend />
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {memCategories.length > 0 && (
        <ChartSection title="Memory by Category">
          <div className="flex gap-6">
            <div className="w-64 shrink-0">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={memCategories}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {memCategories.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, fontSize: 12 }}
                    formatter={tooltipFmt(formatBytes)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Bytes</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {memCategories.map((c, i) => (
                    <tr key={c.name} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {c.name}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatBytes(c.value)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(c.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ChartSection>
      )}

      {memCategories.length === 0 && memOverTime.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
          No detailed memory data available.
          <br />
          <span className="text-xs">Enable query_metric_log and memory profiler for detailed analysis.</span>
        </div>
      )}
    </div>
  );
}

function extractMemoryCategories(events: Record<string, number>): { name: string; value: number; count: number }[] {
  const categoryMap = new Map<string, { value: number; count: number }>();

  const memEvents: [string, string][] = [
    ["ArenaAllocBytes", "Arena"],
    ["ArenaAllocCount", "Arena"],
    ["CacheBytesReadFromFilesystem", "Filesystem Cache"],
    ["CacheBytesWriteToFilesystem", "Filesystem Cache"],
    ["CachedReadBufferCacheWriteBytes", "Cache Writes"],
    ["MarkCacheHits", "Mark Cache"],
    ["MarkCacheMisses", "Mark Cache"],
    ["PrimaryKeyCacheHits", "PK Cache"],
    ["PrimaryKeyCacheMisses", "PK Cache"],
    ["CompressedReadBufferBytes", "Compressed Reads"],
    ["UncompressedReadBufferBytes", "Uncompressed Reads"],
    ["ReadBufferFromS3Bytes", "S3 I/O"],
    ["ReadBufferFromAzureBytes", "Azure I/O"],
    ["NetworkReceiveBytes", "Network Recv"],
    ["NetworkSendBytes", "Network Send"],
    ["IOBufferAllocBytes", "I/O Buffers"],
    ["IOBufferAllocCount", "I/O Buffers"],
    ["MemoryAllocatorAllocBytes", "Allocator"],
    ["MemoryAllocatorDeallocBytes", "Allocator"],
    ["MemoryTrackingAllocated", "Tracked Alloc"],
    ["MemoryTrackingFreed", "Tracked Free"],
    ["QueryMemoryLimit", "Query Limit"],
    ["ExternalSortingUncompressedBytes", "External Sort"],
    ["ExternalAggregationUncompressedBytes", "External Agg"],
    ["GrpcClients", "gRPC"],
    ["HTTPConnection", "HTTP"],
    ["InterserverConnection", "Interserver"],
    ["MySQLConnection", "MySQL"],
    ["NaturalEqual", "JOIN Memory"],
    ["NaturalIf", "JOIN Memory"],
  ];

  for (const [eventKey, category] of memEvents) {
    const val = events[eventKey] || events[`ProfileEvent_${eventKey}`] || 0;
    if (val > 0) {
      const existing = categoryMap.get(category) || { value: 0, count: 0 };
      categoryMap.set(category, {
        value: existing.value + val,
        count: existing.count + 1,
      });
    }
  }

  return Array.from(categoryMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value);
}

function MetricCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
      <div className="mb-1 flex items-center gap-2 text-[var(--color-text-secondary)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={`text-lg font-semibold ${color || "text-[var(--color-text-primary)]"}`}>{value}</div>
    </div>
  );
}

function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
      <h3 className="mb-4 text-sm font-medium text-[var(--color-text-secondary)]">{title}</h3>
      {children}
    </div>
  );
}

interface MetricDelta {
  time: string;
  memory: number;
  peak: number;
  userTime: number;
  systemTime: number;
  readBytes: number;
  writeBytes: number;
  netRecv: number;
  netSend: number;
}

function computeMetricDeltas(points: MetricPoint[]): MetricDelta[] {
  if (points.length === 0) return [];
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1] : p;
    const t = new Date(p.event_time);
    const time = t.toLocaleTimeString();
    return {
      time,
      memory: p.memory_usage,
      peak: p.peak_memory_usage,
      userTime: p.user_time_microseconds - prev.user_time_microseconds,
      systemTime: p.system_time_microseconds - prev.system_time_microseconds,
      readBytes: p.read_bytes - prev.read_bytes,
      writeBytes: p.write_bytes - prev.write_bytes,
      netRecv: p.network_receive_bytes - prev.network_receive_bytes,
      netSend: p.network_send_bytes - prev.network_send_bytes,
    };
  });
}

function getTopProfileEvents(events: Record<string, number>): [string, number, string][] {
  return Object.entries(events)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([name, value]) => [name, value, categorizeEvent(name)]);
}
