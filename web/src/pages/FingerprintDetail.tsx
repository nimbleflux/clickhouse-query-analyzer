import { useState, useEffect, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { Fingerprint, TrendingUp, Clock, MemoryStick, HardDrive, Cpu, AlertTriangle, ChevronRight, Copy } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { useTheme } from "../api/theme";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { fetchFingerprintTrend, fetchFingerprintQueries } from "../api/client";
import type { TrendPoint, FingerprintQuery } from "../api/types";
import { CardSkeleton } from "../components/Skeleton";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";

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

type Interval = "hour" | "day";

export function FingerprintDetail() {
  const { hash } = useParams<{ hash: string }>();
  const location = useLocation();
  const sampleQuery = (location.state as { query?: string } | null)?.query;
  const theme = useTheme();
  const copy = useCopyToClipboard();
  const navigate = useNavigate();
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [queries, setQueries] = useState<FingerprintQuery[]>([]);
  const [queriesTotal, setQueriesTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [interval, setInterval_] = useState<Interval>("hour");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hash) return;
    setLoading(true);
    setError("");
    try {
      const [trendResult, queriesResult] = await Promise.all([
        fetchFingerprintTrend(hash, interval, undefined, undefined, signal),
        fetchFingerprintQueries(hash, 50, undefined, signal),
      ]);
      setTrend(trendResult);
      setQueries(queriesResult.queries);
      setQueriesTotal(queriesResult.total);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load trend");
    } finally {
      setLoading(false);
    }
  }, [hash, interval]);

  const loadMore = useCallback(async () => {
    if (!hash || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchFingerprintQueries(hash, 50, queries.length);
      setQueries((prev) => [...prev, ...result.queries]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [hash, queries.length, loadingMore]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!hash) {
    return <div className="py-12 text-center text-[var(--color-error)]">Invalid fingerprint hash</div>;
  }

  const isDark = theme === "dark";
  const gridColor = isDark ? "#334155" : "#e2e8f0";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  const fmtDuration = (v: number) => formatDuration(v);
  const fmtBucket = (v: string) => {
    try {
      const d = new Date(v);
      if (interval === "day") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return v;
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/fingerprints" className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            Fingerprints
          </Link>
          <ChevronRight className="h-3 w-3 text-[var(--color-text-secondary)]" />
          <div className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-semibold">Query Fingerprint</h2>
            <span className="font-mono text-xs text-[var(--color-text-secondary)]">{hash}</span>
            <button onClick={() => copy(hash, "Hash copied!")} className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="Copy hash">
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["hour", "day"] as Interval[]).map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval_(iv)}
              className={`rounded border px-3 py-1.5 text-sm capitalize ${
                interval === iv
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {sampleQuery && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Example Query</span>
            <button onClick={() => sampleQuery && copy(sampleQuery, "Query copied!")} className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="Copy query">
              <Copy className="h-3 w-3" />
            </button>
          </div>
          <CodeMirror
            value={sampleQuery}
            extensions={[sql()]}
            theme={theme === "dark" ? oneDark : undefined}
            editable={false}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            className="text-xs [&_.cm-editor]:!bg-transparent [&_.cm-content]:!p-0 [&_.cm-scroller]:!max-h-32 [&_.cm-scroller]:!overflow-auto [&_.cm-gutters]:!bg-transparent"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">{error}</div>
      )}

      {loading && trend.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : trend.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p>No historical data for this fingerprint</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
              <TrendingUp className="h-3.5 w-3.5" />
              Latency Over Time
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmtDuration} tick={{ fill: textColor, fontSize: 10 }} width={70} />
                <Tooltip
                  contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={labelFmt(fmtBucket)}
                  formatter={tooltipFmt(fmtDuration)}
                />
                <Area type="monotone" dataKey="p95_duration_ms" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} name="P95" />
                <Area type="monotone" dataKey="p50_duration_ms" stroke="#f59e0b" fill="#f59e0b20" strokeWidth={1.5} name="P50" />
                <Area type="monotone" dataKey="avg_duration_ms" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} name="Avg" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Memory Usage</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fill: textColor, fontSize: 10 }} width={70} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatBytes)}
                  />
                  <Area type="monotone" dataKey="max_memory_usage" stroke="#a855f7" fill="#a855f720" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_memory_usage" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Execution Count</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: textColor, fontSize: 10 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatNumber)}
                  />
                  <Bar dataKey="execution_count" fill="#3b82f680" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">I/O Throughput (Read)</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fill: textColor, fontSize: 10 }} width={70} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatBytes)}
                  />
                  <Area type="monotone" dataKey="max_read_bytes" stroke="#f97316" fill="#f9731620" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_read_bytes" stroke="#fb923c" fill="#fb923c20" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Rows Scanned</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: textColor, fontSize: 10 }} width={60} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatNumber)}
                  />
                  <Area type="monotone" dataKey="max_read_rows" stroke="#22c55e" fill="#22c55e20" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_read_rows" stroke="#4ade80" fill="#4ade8020" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Result Rows</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: textColor, fontSize: 10 }} width={60} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatNumber)}
                  />
                  <Area type="monotone" dataKey="max_result_rows" stroke="#06b6d4" fill="#06b6d420" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_result_rows" stroke="#22d3ee" fill="#22d3ee20" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Thread Usage</div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: textColor, fontSize: 10 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatNumber)}
                  />
                  <Area type="monotone" dataKey="max_peak_threads" stroke="#eab308" fill="#eab30820" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_peak_threads" stroke="#facc15" fill="#facc1520" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {trend.some((t) => t.error_count > 0) && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="mb-3 text-xs font-medium text-[var(--color-error)]">Errors Over Time</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: textColor, fontSize: 10 }} width={40} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={labelFmt(fmtBucket)}
                    formatter={tooltipFmt(formatNumber)}
                  />
                  <Bar dataKey="error_count" fill="#ef444480" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
                <Clock className="h-3.5 w-3.5" />
                Recent Executions
                <span className="text-[var(--color-text-secondary)] opacity-60">({queriesTotal})</span>
              </div>
            </div>
            {queries.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--color-text-secondary)]">No executions found</div>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                      <th className="px-3 py-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Time</th>
                      <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Duration</th>
                      <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Memory</th>
                      <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Rows Read</th>
                      <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Data Read</th>
                      <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Result</th>
                      <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Threads</th>
                      <th className="px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)]">User</th>
                      <th className="px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map((q) => (
                      <tr
                        key={q.query_id}
                        onClick={() => navigate(`/query/${q.query_id}`)}
                        className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-primary)] transition-colors"
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                          {formatTime(q.event_time)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs ${durationColor(q.query_duration_ms)}`}>
                          {formatDuration(q.query_duration_ms)}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs ${memoryColor(q.memory_usage)}`}>
                          <div className="flex items-center justify-end gap-1">
                            <MemoryStick className="h-3 w-3" />
                            {formatBytes(q.memory_usage)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                          {formatNumber(q.read_rows)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                          <div className="flex items-center justify-end gap-1">
                            <HardDrive className="h-3 w-3" />
                            {formatBytes(q.read_bytes)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                          {formatNumber(q.result_rows)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                          <div className="flex items-center justify-end gap-1">
                            <Cpu className="h-3 w-3" />
                            {q.peak_threads_usage}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                          {q.user}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                          {q.type === "QueryFinish" ? (
                            <span className="text-[var(--color-success)]">OK</span>
                          ) : (
                            <span className="flex items-center gap-1 text-[var(--color-error)]" title={q.exception || undefined}>
                              <AlertTriangle className="h-3 w-3" />
                              Error
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {queries.length > 0 && queries.length < queriesTotal && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded border border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : `Load more (${queriesTotal - queries.length} remaining)`}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
              <Clock className="h-3.5 w-3.5" />
              Raw Data ({trend.length} data points)
            </div>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Bucket</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Count</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Avg</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">P95</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Avg Mem</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Avg Read</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Avg Rows</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Avg Result</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Threads</th>
                    <th className="px-3 py-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((t, i) => (
                    <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">{fmtBucket(t.bucket)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.execution_count)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatDuration(t.avg_duration_ms)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatDuration(t.p95_duration_ms)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatBytes(t.avg_memory_usage)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatBytes(t.avg_read_bytes)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.avg_read_rows)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.avg_result_rows)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(t.avg_peak_threads)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono text-xs ${t.error_count > 0 ? "text-[var(--color-error)]" : ""}`}>
                        {t.error_count || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
