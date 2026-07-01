import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, TrendingUp, ExternalLink } from "lucide-react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchQueryHealthTrend } from "../api/client";
import type { QueryHealthPoint } from "../api/types";
import { ApiError } from "../api/errors";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";
import { formatBytes } from "../utils";

const fmtBucket = (b: unknown) => {
  const s = String(b ?? "");
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? s : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const BUCKET_LABEL: Record<number, string> = { 1: "5 min", 24: "1 hour", 168: "6 hours" };

export function Trends({ connected }: { connected: boolean }) {
  const [data, setData] = useState<QueryHealthPoint[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedTimer(loading);
  const bucketLabel = BUCKET_LABEL[hours] ?? "1 hour";
  const fromTime = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);

  const load = useCallback(async (h: number) => {
    setCanceled(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setData(await fetchQueryHealthTrend(h, controller.signal));
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      if (!controllerRef.current?.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { if (connected) load(hours); }, [load, hours, connected]);
  const cancel = useCallback(() => { setCanceled(true); controllerRef.current?.abort(); setLoading(false); }, []);

  if (!connected) return <NotConnectedState />;
  if (error && data.length === 0) return <PageContainer><ErrorState error={error} onRetry={() => load(hours)} /></PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Trends"
        description="Cluster-wide query health over time (system.query_log)"
        actions={
          <>
            {loading && data.length > 0 && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={() => load(hours)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-secondary)]">Timeframe:</span>
        <TimeframeSelector
          options={[
            { label: "1h", value: 1 },
            { label: "24h", value: 24 },
            { label: "7d", value: 168 },
          ]}
          value={hours}
          onChange={setHours}
        />
        <span className="text-xs text-[var(--color-text-secondary)] opacity-70">bucket size: {bucketLabel}</span>
      </div>

      {error && data.length > 0 && <div className="mb-4"><ErrorState error={error} onRetry={() => load(hours)} /></div>}

      {loading && data.length === 0 ? (
        <div className="py-4 text-xs text-[var(--color-text-secondary)]"><LoadingNotice elapsed={elapsed} onCancel={cancel} /></div>
      ) : canceled && data.length === 0 ? (
        <LoadingNotice canceled onRetry={() => load(hours)} />
      ) : data.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No query data in this window" description="No queries logged in the selected timeframe." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={`Queries (${bucketLabel} buckets)`} description="Completed user queries per bucket. Volume = throughput." drillTo={`/queries?from_time=${encodeURIComponent(fromTime)}`}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data}>
                <defs><linearGradient id="gCount" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Area type="monotone" dataKey="count" name="queries" stroke="var(--color-accent)" fill="url(#gCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Latency p50 / p95 (ms)" description="50th / 95th percentile query duration. p95 spikes = tail-latency outliers." drillTo={`/queries?from_time=${encodeURIComponent(fromTime)}`}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data}>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Line type="monotone" dataKey="p50_duration_ms" name="p50" stroke="var(--color-text-secondary)" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="p95_duration_ms" name="p95" stroke="var(--color-error)" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={`Errors (${bucketLabel} buckets)`} description="Queries that failed with an exception. Click → to investigate." drillTo={`/queries?from_time=${encodeURIComponent(fromTime)}&errors_only=true`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data}>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Bar dataKey="errors" name="errors" fill="var(--color-error)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={`Avg memory (${bucketLabel} buckets)`} description="Average peak memory per query. Spikes = memory-heavy workload." drillTo={`/queries?from_time=${encodeURIComponent(fromTime)}`}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data}>
                <defs><linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v)} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} formatter={(v: unknown) => [formatBytes(Number(v)), "avg memory"]} />
                <Area type="monotone" dataKey="avg_memory" name="avg memory" stroke="var(--color-accent)" fill="url(#gMem)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </PageContainer>
  );
}

function ChartCard({ title, description, drillTo, children }: { title: string; description: string; drillTo?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-[var(--color-text-secondary)]">{title}</div>
          <div className="text-[10px] text-[var(--color-text-secondary)] opacity-70">{description}</div>
        </div>
        {drillTo && (
          <Link to={drillTo} title="View queries in this timeframe" className="shrink-0 rounded p-1 text-[var(--color-accent)] hover:bg-[var(--surface-hover)]">
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </Card>
  );
}
