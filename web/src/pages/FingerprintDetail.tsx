import { useState, useEffect, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { Fingerprint, TrendingUp, Clock, MemoryStick, HardDrive, Cpu, AlertTriangle, ChevronRight, Copy, Send, GitCompare } from "lucide-react";
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
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { sendToEditor } from "@/lib/send-to-editor";
import { ApiError } from "@/api/errors";

type Interval = "hour" | "day";

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

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
}

function ChartCard({ title, children }: ChartCardProps) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">{title}</div>
      {children}
    </Card>
  );
}

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 2) next.clear();
        next.add(id);
      }
      return next;
    });
  }, []);

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
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Failed to load trend"));
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
    return <PageContainer><ErrorState error="Invalid fingerprint hash" /></PageContainer>;
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

  const tooltipStyle = { background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Query Fingerprint"
        breadcrumb={
          <Link to="/fingerprints" className="flex items-center gap-1 text-xs hover:text-[var(--color-accent)]">
            <Fingerprint className="h-3 w-3" />
            Fingerprints
            <ChevronRight className="h-3 w-3" />
          </Link>
        }
        description={
          <span className="flex items-center gap-2">
            <span className="font-mono">{hash}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => copy(hash, "Hash copied!")} title="Copy hash">
              <Copy className="h-3 w-3" />
            </Button>
          </span>
        }
        actions={
          <>
            {sampleQuery && (
              <Button variant="secondary" size="md" onClick={() => sendToEditor(navigate, sampleQuery, { origin: "fingerprint" })}>
                <Send className="h-3.5 w-3.5" />
                Open in Editor
              </Button>
            )}
            <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5">
              {(["hour", "day"] as Interval[]).map((iv) => (
                <Button
                  key={iv}
                  variant="ghost"
                  size="sm"
                  active={interval === iv}
                  onClick={() => setInterval_(iv)}
                  className="capitalize"
                >
                  {iv}
                </Button>
              ))}
            </div>
          </>
        }
      />

      {sampleQuery && (
        <Card className="p-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Example Query</span>
            <Button variant="ghost" size="icon-sm" onClick={() => sampleQuery && copy(sampleQuery, "Query copied!")} title="Copy query">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <CodeMirror
            value={sampleQuery}
            extensions={[sql()]}
            theme={theme === "dark" ? oneDark : undefined}
            editable={false}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            className="text-xs [&_.cm-editor]:!bg-transparent [&_.cm-content]:!p-0 [&_.cm-scroller]:!max-h-32 [&_.cm-scroller]:!overflow-auto [&_.cm-gutters]:!bg-transparent"
          />
        </Card>
      )}

      {error && <ErrorState error={error} onRetry={() => load()} />}

      {loading && trend.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : trend.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No historical data for this fingerprint"
          description="Either no queries match this hash in the selected time range, or query_log is not enabled."
        />
      ) : (
        <div className="space-y-4">
          <ChartCard title="Latency Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmtDuration} tick={{ fill: textColor, fontSize: 10 }} width={70} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(fmtDuration)} />
                <Area type="monotone" dataKey="p95_duration_ms" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} name="P95" />
                <Area type="monotone" dataKey="p50_duration_ms" stroke="#f59e0b" fill="#f59e0b20" strokeWidth={1.5} name="P50" />
                <Area type="monotone" dataKey="avg_duration_ms" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} name="Avg" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Memory Usage">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fill: textColor, fontSize: 10 }} width={70} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatBytes)} />
                  <Area type="monotone" dataKey="max_memory_usage" stroke="#a855f7" fill="#a855f720" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_memory_usage" stroke="#8b5cf6" fill="#8b5cf620" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Execution Count">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: textColor, fontSize: 10 }} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatNumber)} />
                  <Bar dataKey="execution_count" fill="#3b82f680" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="I/O Throughput (Read)">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fill: textColor, fontSize: 10 }} width={70} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatBytes)} />
                  <Area type="monotone" dataKey="max_read_bytes" stroke="#f97316" fill="#f9731620" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_read_bytes" stroke="#fb923c" fill="#fb923c20" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Rows Scanned">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: textColor, fontSize: 10 }} width={60} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatNumber)} />
                  <Area type="monotone" dataKey="max_read_rows" stroke="#22c55e" fill="#22c55e20" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_read_rows" stroke="#4ade80" fill="#4ade8020" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Result Rows">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: textColor, fontSize: 10 }} width={60} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatNumber)} />
                  <Area type="monotone" dataKey="max_result_rows" stroke="#06b6d4" fill="#06b6d420" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_result_rows" stroke="#22d3ee" fill="#22d3ee20" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Thread Usage">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: textColor, fontSize: 10 }} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatNumber)} />
                  <Area type="monotone" dataKey="max_peak_threads" stroke="#eab308" fill="#eab30820" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="avg_peak_threads" stroke="#facc15" fill="#facc1520" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {trend.some((t) => t.error_count > 0) && (
            <ChartCard title="Errors Over Time">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: textColor, fontSize: 10 }} width={40} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt(fmtBucket)} formatter={tooltipFmt(formatNumber)} />
                  <Bar dataKey="error_count" fill="#ef444480" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <RegressionAnalysisCard trend={trend} />

          <RecentExecutionsCard
            queries={queries}
            queriesTotal={queriesTotal}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            onNavigate={(id) => navigate(`/query/${id}`)}
            selected={selected}
            onToggleSelect={toggleSelect}
            onCompare={(a, b) => navigate(`/compare?a=${a}&b=${b}`)}
          />

          <RawTrendDataTable trend={trend} fmtBucket={fmtBucket} />
        </div>
      )}
    </PageContainer>
  );
}

interface RegressionMetric {
  label: string;
  baseline: number;
  recent: number;
  deltaPct: number;
  format: (v: number) => string;
  higherIsWorse: boolean;
}

function RegressionAnalysisCard({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 5) return null;

  const recentCount = Math.min(3, Math.floor(trend.length / 4));
  const recentPoints = trend.slice(-recentCount);
  const baselinePoints = trend.slice(0, -recentCount);

  if (baselinePoints.length === 0) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const metrics: RegressionMetric[] = [
    {
      label: "P95 Duration",
      baseline: avg(baselinePoints.map((p) => p.p95_duration_ms)),
      recent: avg(recentPoints.map((p) => p.p95_duration_ms)),
      deltaPct: 0,
      format: formatDuration,
      higherIsWorse: true,
    },
    {
      label: "Avg Duration",
      baseline: avg(baselinePoints.map((p) => p.avg_duration_ms)),
      recent: avg(recentPoints.map((p) => p.avg_duration_ms)),
      deltaPct: 0,
      format: formatDuration,
      higherIsWorse: true,
    },
    {
      label: "Avg Memory",
      baseline: avg(baselinePoints.map((p) => p.avg_memory_usage)),
      recent: avg(recentPoints.map((p) => p.avg_memory_usage)),
      deltaPct: 0,
      format: formatBytes,
      higherIsWorse: true,
    },
    {
      label: "Avg Read Rows",
      baseline: avg(baselinePoints.map((p) => p.avg_read_rows)),
      recent: avg(recentPoints.map((p) => p.avg_read_rows)),
      deltaPct: 0,
      format: formatNumber,
      higherIsWorse: true,
    },
    {
      label: "Error Rate",
      baseline: avg(baselinePoints.map((p) => p.error_count / Math.max(1, p.execution_count) * 100)),
      recent: avg(recentPoints.map((p) => p.error_count / Math.max(1, p.execution_count) * 100)),
      deltaPct: 0,
      format: (v) => `${v.toFixed(2)}%`,
      higherIsWorse: true,
    },
  ];

  for (const m of metrics) {
    m.deltaPct = m.baseline > 0 ? ((m.recent - m.baseline) / m.baseline) * 100 : 0;
  }

  const regressions = metrics.filter((m) => m.higherIsWorse && m.deltaPct > 25);
  const improvements = metrics.filter((m) => m.higherIsWorse && m.deltaPct < -25);

  const titleIcon = regressions.length > 0
    ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    : improvements.length > 0
      ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
      : <TrendingUp className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />;
  const titleColor = regressions.length > 0
    ? "text-amber-500"
    : improvements.length > 0
      ? "text-emerald-500"
      : "text-[var(--color-text-secondary)]";

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium">
        <span className={titleColor}>{titleIcon}</span>
        <span className={titleColor}>Regression Analysis</span>
        <span className="text-[var(--color-text-secondary)] opacity-60">
          (recent {recentCount} buckets vs {baselinePoints.length} baseline)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
              <th className="py-1.5 pr-3 text-left font-normal">Metric</th>
              <th className="py-1.5 pr-3 text-right font-normal">Baseline</th>
              <th className="py-1.5 pr-3 text-right font-normal">Recent</th>
              <th className="py-1.5 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const color = m.deltaPct > 25 ? "text-rose-500" : m.deltaPct < -25 ? "text-emerald-500" : "text-[var(--color-text-secondary)]";
              const arrow = m.deltaPct > 25 ? "↑" : m.deltaPct < -25 ? "↓" : "→";
              return (
                <tr key={m.label} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1.5 pr-3">{m.label}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{m.format(m.baseline)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{m.format(m.recent)}</td>
                  <td className={`py-1.5 text-right font-mono ${color}`}>
                    {arrow} {m.baseline > 0 ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {regressions.length > 0 && (
        <p className="mt-3 text-xs text-amber-500">
          ⚠ {regressions.length} metric{regressions.length > 1 ? "s" : ""} regressed by &gt;25% vs baseline.
        </p>
      )}
      {regressions.length === 0 && improvements.length > 0 && (
        <p className="mt-3 text-xs text-emerald-500">
          ✓ {improvements.length} metric{improvements.length > 1 ? "s" : ""} improved by &gt;25% vs baseline.
        </p>
      )}
      {regressions.length === 0 && improvements.length === 0 && (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          No significant changes detected (&lt;±25% on all metrics).
        </p>
      )}
    </Card>
  );
}

function RecentExecutionsCard({
  queries,
  queriesTotal,
  loadingMore,
  onLoadMore,
  onNavigate,
  selected,
  onToggleSelect,
  onCompare,
}: {
  queries: FingerprintQuery[];
  queriesTotal: number;
  loadingMore: boolean;
  onLoadMore: () => void;
  onNavigate: (queryId: string) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onCompare: (a: string, b: string) => void;
}) {
  const selectedArr = Array.from(selected);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
          <Clock className="h-3.5 w-3.5" />
          Recent Executions
          <span className="text-[var(--color-text-secondary)] opacity-60">({queriesTotal})</span>
        </div>
        {selected.size > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={selected.size !== 2}
            onClick={() => onCompare(selectedArr[0], selectedArr[1])}
            title={selected.size === 2 ? "Compare selected queries" : `Select one more (${2 - selected.size} needed)`}
          >
            <GitCompare className="h-3.5 w-3.5" />
            Compare ({selected.size}/2)
          </Button>
        )}
      </div>
      {queries.length === 0 ? (
        <div className="py-4 text-center text-xs text-[var(--color-text-secondary)]">No executions found</div>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--surface-base)]">
                <th className="w-8 px-2 py-1.5"></th>
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
                  onClick={() => onNavigate(q.query_id)}
                  className={`cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors ${selected.has(q.query_id) ? "bg-[var(--state-accent)]" : ""}`}
                >
                  <td className="px-2 py-1.5" onClick={(e) => { e.stopPropagation(); onToggleSelect(q.query_id); }}>
                    <input
                      type="checkbox"
                      checked={selected.has(q.query_id)}
                      disabled={!selected.has(q.query_id) && selected.size >= 2}
                      readOnly
                      className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
                    />
                  </td>
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
          <Button variant="secondary" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load more (${queriesTotal - queries.length} remaining)`}
          </Button>
        </div>
      )}
    </Card>
  );
}

function RawTrendDataTable({ trend, fmtBucket }: { trend: TrendPoint[]; fmtBucket: (v: string) => string }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
        <Clock className="h-3.5 w-3.5" />
        Raw Data ({trend.length} data points)
      </div>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--surface-base)]">
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
    </Card>
  );
}
