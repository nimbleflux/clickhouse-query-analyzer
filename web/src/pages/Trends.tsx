import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, TrendingUp, ExternalLink } from "lucide-react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchQueryHealthTrend } from "../api/client";
import type { QueryHealthPoint } from "../api/types";
import { usePollingQuery } from "@/hooks/usePollingQuery";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";
import { formatBytes, formatDateTime } from "../utils";

const fmtBucket = (b: unknown) => formatDateTime(String(b ?? ""));

const BUCKET_LABEL: Record<number, string> = { 1: "5 min", 24: "1 hour", 168: "6 hours" };

/** Drill-down link into the query list for the chart's timeframe. */
function DrillLink({ to }: { to: string }) {
  return (
    <Link to={to} title="View queries in this timeframe" className="shrink-0 rounded p-1 text-[var(--color-accent)] hover:bg-[var(--surface-hover)]">
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

export function Trends({ connected }: { connected: boolean }) {
  const [hours, setHours] = useState(24);
  const fetcher = useCallback((signal: AbortSignal) => fetchQueryHealthTrend(hours, signal), [hours]);
  const {
    data,
    loading,
    error,
    canceled,
    elapsed,
    cancel,
    reload,
  } = usePollingQuery<QueryHealthPoint[]>(fetcher, { deps: [hours], enabled: connected });

  const points = data ?? [];
  const bucketLabel = BUCKET_LABEL[hours] ?? "1 hour";
  const fromTime = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const drill = `/queries?from_time=${encodeURIComponent(fromTime)}`;

  if (!connected) return <NotConnectedState />;
  if (error && points.length === 0) return <PageContainer><ErrorState error={error} onRetry={reload} /></PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        title="Trends"
        description="Cluster-wide query health over time (system.query_log)"
        actions={
          <>
            {loading && points.length > 0 && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={reload} disabled={loading}>
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

      {error && points.length > 0 && <div className="mb-4"><ErrorState error={error} onRetry={reload} /></div>}

      {loading && points.length === 0 ? (
        <div className="py-4 text-xs text-[var(--color-text-secondary)]"><LoadingNotice elapsed={elapsed} onCancel={cancel} /></div>
      ) : canceled && points.length === 0 ? (
        <LoadingNotice canceled onRetry={reload} />
      ) : points.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No query data in this window" description="No queries logged in the selected timeframe." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={`Queries (${bucketLabel} buckets)`} description="Completed user queries per bucket. Volume = throughput." actions={<DrillLink to={drill} />}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={points}>
                <defs><linearGradient id="gCount" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Area type="monotone" dataKey="count" name="queries" stroke="var(--color-accent)" fill="url(#gCount)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Latency p50 / p95 (ms)" description="50th / 95th percentile query duration. p95 spikes = tail-latency outliers." actions={<DrillLink to={drill} />}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={points}>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Line type="monotone" dataKey="p50_duration_ms" name="p50" stroke="var(--color-text-secondary)" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="p95_duration_ms" name="p95" stroke="var(--color-error)" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={`Errors (${bucketLabel} buckets)`} description="Queries that failed with an exception. Click → to investigate." actions={<DrillLink to={`${drill}&errors_only=true`} />}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={points}>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Bar dataKey="errors" name="errors" fill="var(--color-error)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={`Avg memory (${bucketLabel} buckets)`} description="Average peak memory per query. Spikes = memory-heavy workload." actions={<DrillLink to={drill} />}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={points}>
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
