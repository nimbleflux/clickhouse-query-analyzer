import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";
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
import { formatNumber } from "../utils";

const fmtBucket = (b: unknown) => {
  const s = String(b ?? "");
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? s : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function Trends({ connected }: { connected: boolean }) {
  const [data, setData] = useState<QueryHealthPoint[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedTimer(loading);

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
          <ChartCard title="Queries / bucket">
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

          <ChartCard title="Latency p50 / p95 (ms)">
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

          <ChartCard title="Errors / bucket">
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

          <ChartCard title="Avg memory / bucket (bytes)">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data}>
                <defs><linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.4} /><stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fontSize: 10 }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(v)} />
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <Tooltip labelFormatter={fmtBucket} />
                <Area type="monotone" dataKey="avg_memory" name="avg memory" stroke="var(--color-accent)" fill="url(#gMem)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </PageContainer>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">{title}</div>
      {children}
    </Card>
  );
}
