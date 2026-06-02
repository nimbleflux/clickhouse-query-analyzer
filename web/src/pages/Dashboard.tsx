import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Gauge, Database, HardDrive, Activity, RefreshCw, Server, AlertTriangle, Layers } from "lucide-react";
import { fetchDashboard } from "../api/client";
import type { DashboardData } from "../api/types";
import { formatBytes, formatNumber } from "../utils";
import { CardSkeleton } from "../components/Skeleton";

function Card({ title, icon, scrollable, children }: { title: string; icon: React.ReactNode; scrollable?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 ${scrollable ? "flex max-h-80 flex-col" : ""}`}>
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
        {icon}
        {title}
      </div>
      <div className={scrollable ? "overflow-y-auto" : ""}>
        {children}
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] py-1.5 last:border-0">
      <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className={`font-mono text-xs ${color || "text-[var(--color-text-primary)]"}`}>{value}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatEventValue(name: string, value: number): string {
  if (name.endsWith("Bytes")) return formatBytes(value);
  return formatNumber(value);
}

export function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchDashboard(signal);
      setData(result);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      const controller = new AbortController();
      intervalRef.current = setInterval(() => load(controller.signal), refreshInterval * 1000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); controller.abort(); };
    }
    return () => {};
  }, [autoRefresh, refreshInterval, load]);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">{error}</div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const queryCount = data.metrics.find((m) => m.metric === "Query")?.value || 0;
  const mergeCount = data.metrics.find((m) => m.metric === "Merge")?.value || 0;
  const partCount = data.metrics.find((m) => m.metric === "Part")?.value || 0;
  const replicationQueue = data.metrics.find((m) => m.metric === "ReplicationQueue")?.value || 0;
  const replicationLag = data.metrics.find((m) => m.metric === "ReplicasMaxAbsoluteDelay")?.value || 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-semibold">System Dashboard</h2>
            {(data.nodes?.length ?? 0) > 0 && <span className="text-xs text-[var(--color-text-secondary)]">v{data.nodes[0].version}</span>}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className={`rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)] outline-none ${!autoRefresh ? "opacity-50" : ""}`}
              disabled={!autoRefresh}
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-colors ${
                autoRefresh
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <RefreshCw className={`h-3 w-3 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: `${refreshInterval}s` } : undefined} />
              Live
            </button>
            <button
              onClick={() => load()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="text-xs text-[var(--color-text-secondary)]">Uptime{(data.nodes?.length ?? 0) > 1 ? ` (${data.nodes.length} nodes)` : ""}</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">
            {(data.nodes?.length ?? 0) === 1
              ? formatUptime(data.nodes[0].uptime)
              : (data.nodes?.length ?? 0) > 1
                ? data.nodes.map((n) => (
                    <div key={n.host} className="text-sm">
                      <span className="text-[var(--color-text-secondary)]">{n.host}</span> {formatUptime(n.uptime)}
                    </div>
                  ))
                : "-"}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <Activity className="h-3 w-3" />Active Queries
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--color-accent)]">{formatNumber(queryCount)}</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <Layers className="h-3 w-3" />Active Merges
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">{formatNumber(mergeCount)}</div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <HardDrive className="h-3 w-3" />Active Parts
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">{formatNumber(partCount)}</div>
        </div>
      </div>

      {replicationQueue > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-2 text-sm text-[var(--color-warning)]">
          <AlertTriangle className="h-4 w-4" />
          Replication queue: {replicationQueue} pending
          {replicationLag > 0 && <span className="ml-2">(max delay: {formatUptime(replicationLag)})</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Database Sizes" icon={<Database className="h-3.5 w-3.5" />} scrollable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Database</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Tables</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Rows</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Compressed</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Uncompressed</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.database_sizes.map((d) => (
                <tr
                  key={d.database}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-tertiary)]"
                  onClick={() => navigate(`/optimizer?db=${encodeURIComponent(d.database)}`)}
                  title={`Analyze tables in ${d.database}`}
                >
                  <td className="py-1.5 text-xs text-[var(--color-accent)]">{d.database}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{d.tables}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(d.rows)}</td>
                  <td className="py-1.5 text-right font-mono text-xs">{formatBytes(d.compressed_bytes)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatBytes(d.uncompressed_bytes)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{d.compressed_bytes > 0 ? (d.uncompressed_bytes / d.compressed_bytes).toFixed(1) + "x" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Top Tables by Size" icon={<HardDrive className="h-3.5 w-3.5" />} scrollable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Parts</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Compressed</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Uncompressed</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.top_tables_by_size.map((t) => (
                <tr
                  key={`${t.database}.${t.table}`}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-tertiary)]"
                  onClick={() => navigate(`/optimizer/${encodeURIComponent(t.database)}/${encodeURIComponent(t.table)}`)}
                  title={`Analyze ${t.database}.${t.table}`}
                >
                  <td className="py-1.5 text-xs">
                    <span className="text-[var(--color-text-secondary)]">{t.database}.</span><span className="text-[var(--color-accent)]">{t.table}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(t.parts)}</td>
                  <td className="py-1.5 text-right font-mono text-xs">{formatBytes(t.compressed_bytes)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatBytes(t.uncompressed_bytes)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{t.compressed_bytes > 0 ? (t.uncompressed_bytes / t.compressed_bytes).toFixed(1) + "x" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Tables with Most Parts" icon={<Layers className="h-3.5 w-3.5" />} scrollable>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Parts</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Rows</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Compressed</th>
                <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.top_tables_by_parts.map((t) => (
                <tr
                  key={`${t.database}.${t.table}`}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-tertiary)]"
                  onClick={() => navigate(`/optimizer/${encodeURIComponent(t.database)}/${encodeURIComponent(t.table)}`)}
                  title={`Analyze ${t.database}.${t.table}`}
                >
                  <td className="py-1.5 text-xs">
                    <span className="text-[var(--color-text-secondary)]">{t.database}.</span><span className="text-[var(--color-accent)]">{t.table}</span>
                  </td>
                  <td className={`py-1.5 text-right font-mono text-xs ${t.parts > 100 ? "text-[var(--color-warning)]" : ""}`}>{formatNumber(t.parts)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(t.rows)}</td>
                  <td className="py-1.5 text-right font-mono text-xs">{formatBytes(t.compressed_bytes)}</td>
                  <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{t.compressed_bytes > 0 ? (t.uncompressed_bytes / t.compressed_bytes).toFixed(1) + "x" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Top System Events" icon={<Activity className="h-3.5 w-3.5" />} scrollable>
          <div>
            {data.recent_events.map((e, i) => (
              <div key={`${e.event}-${e.host}-${i}`} className="flex items-center justify-between border-b border-[var(--color-border)] py-1.5 last:border-0">
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {e.event.replace(/([A-Z])/g, " $1").trim()}
                  {(data.nodes?.length ?? 0) > 1 && <span className="ml-1 opacity-60">({e.host})</span>}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-primary)]">{formatEventValue(e.event, e.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="System Metrics" icon={<Gauge className="h-3.5 w-3.5" />} scrollable>
          {data.metrics.map((m) => (
            <MetricRow key={m.metric} label={m.metric.replace(/([A-Z])/g, " $1").trim()} value={formatEventValue(m.metric, m.value)} />
          ))}
        </Card>

        {data.replica_statuses.length > 0 && (
          <Card title="Replica Status" icon={<Server className="h-3.5 w-3.5" />} scrollable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Replica</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Leader</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Delay</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Queue</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Active</th>
                </tr>
              </thead>
              <tbody>
                {data.replica_statuses.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1.5 text-xs">
                      <span className="text-[var(--color-text-secondary)]">{r.database}.</span>{r.table}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{r.replica_name}</td>
                    <td className="py-1.5 text-right font-mono text-xs">{r.is_leader ? "Yes" : "-"}</td>
                    <td className={`py-1.5 text-right font-mono text-xs ${r.absolute_delay > 60 ? "text-[var(--color-error)]" : r.absolute_delay > 0 ? "text-[var(--color-warning)]" : ""}`}>
                      {r.absolute_delay > 0 ? `${r.absolute_delay.toFixed(0)}s` : "-"}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs">{r.queue_size || "-"}</td>
                    <td className="py-1.5 text-right font-mono text-xs">{r.active_replicas}/{r.total_replicas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {data.replication_queue.length > 0 && (
          <Card title="Replication Queue" icon={<AlertTriangle className="h-3.5 w-3.5" />} scrollable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Type</th>
                  <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Tries</th>
                  <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.replication_queue.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1.5 text-xs">
                      <span className="text-[var(--color-text-secondary)]">{r.database}.</span>{r.table}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs">{r.type}</td>
                    <td className={`py-1.5 text-right font-mono text-xs ${r.num_tries > 3 ? "text-[var(--color-error)]" : ""}`}>{r.num_tries}</td>
                    <td className="max-w-xs truncate py-1.5 text-xs text-[var(--color-error)]">{r.last_exception || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}
