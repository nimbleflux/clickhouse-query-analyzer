import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Gauge, Database, HardDrive, Activity, RefreshCw, Server, AlertTriangle, Layers, Network, User, CheckCircle2, XCircle, Settings as SettingsIcon, ChevronDown, ChevronRight } from "lucide-react";
import { fetchDashboard } from "../api/client";
import type { DashboardData } from "../api/types";
import { ApiError } from "../api/errors";
import { formatBytes, formatNumber } from "../utils";
import { CardSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, NotConnectedState } from "@/components/ui/state";
import { ClusterNoteBanner } from "@/components/ClusterNoteBanner";

interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  color?: string;
  className?: string;
}

function StatCard({ label, value, icon, color, className }: StatCardProps) {
  return (
    <Card className={`p-4 ${className || ""}`}>
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        {icon}
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color || "text-[var(--color-text-primary)]"}`}>
        {value}
      </div>
    </Card>
  );
}

interface TableCardProps {
  title: string;
  icon: React.ReactNode;
  scrollable?: boolean;
  children: React.ReactNode;
}

function TableCard({ title, icon, scrollable, children }: TableCardProps) {
  return (
    <Card className={scrollable ? "flex max-h-80 flex-col" : ""}>
      <div className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
        {icon}
        {title}
      </div>
      <div className={scrollable ? "overflow-y-auto px-4 pb-4" : "px-4 pb-4"}>
        {children}
      </div>
    </Card>
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

export function Dashboard({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDashboard(signal);
      setData(result);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, connected]);

  useEffect(() => {
    if (!connected || !autoRefresh) return;
    const controller = new AbortController();
    intervalRef.current = setInterval(() => load(controller.signal), refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); controller.abort(); };
  }, [autoRefresh, refreshInterval, load, connected]);

  if (!connected) {
    return <NotConnectedState />;
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => load()} />
      </PageContainer>
    );
  }

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (!data) return null;

  const queryCount = data.metrics.find((m) => m.metric === "Query")?.value || 0;
  const mergeCount = data.metrics.find((m) => m.metric === "Merge")?.value || 0;
  const partCount = data.metrics.find((m) => m.metric === "Part")?.value || 0;
  const replicationQueue = data.metrics.find((m) => m.metric === "ReplicationQueue")?.value || 0;
  const replicationLag = data.metrics.find((m) => m.metric === "ReplicasMaxAbsoluteDelay")?.value || 0;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="System Dashboard"
        description={(data.nodes?.length ?? 0) > 0 ? `ClickHouse v${data.nodes[0].version}` : undefined}
        actions={
          <>
            <Select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              disabled={!autoRefresh}
              className={!autoRefresh ? "opacity-50" : ""}
            >
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </Select>
            <Button
              variant={autoRefresh ? "primary" : "secondary"}
              size="md"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: `${refreshInterval}s` } : undefined} />
              Live
            </Button>
            <Button variant="secondary" size="md" onClick={() => load()} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </>
        }
      />

      {data.partial_errors?.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--state-warning)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
          <span>
            Some sections are unavailable — your ClickHouse user may lack access to: {data.partial_errors.join(", ")}.
          </span>
        </div>
      )}

      <ClusterNoteBanner note={data.cluster_note} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={`Uptime${(data.nodes?.length ?? 0) > 1 ? ` (${data.nodes.length} nodes)` : ""}`}
          value={
            (data.nodes?.length ?? 0) === 1
              ? formatUptime(data.nodes[0].uptime)
              : (data.nodes?.length ?? 0) > 1
                ? `${data.nodes.length} nodes`
                : "-"
          }
        />
        <StatCard
          label="Active Queries"
          value={formatNumber(queryCount)}
          icon={<Activity className="h-3 w-3" />}
          color="text-[var(--color-accent)]"
        />
        <StatCard
          label="Active Merges"
          value={formatNumber(mergeCount)}
          icon={<Layers className="h-3 w-3" />}
        />
        <StatCard
          label="Active Parts"
          value={formatNumber(partCount)}
          icon={<HardDrive className="h-3 w-3" />}
        />
      </div>

      {replicationQueue > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--state-warning)] px-4 py-2 text-sm text-[var(--color-warning)]">
          <AlertTriangle className="h-4 w-4" />
          Replication queue: {replicationQueue} pending
          {replicationLag > 0 && <span className="ml-2">(max delay: {formatUptime(replicationLag)})</span>}
        </div>
      )}

      <AnomaliesAndWarningsCard data={data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ConnectionInfoCard data={data} />
        <LogTablesCard data={data} />
        <SettingsCard data={data} />

        <TableCard title="Database Sizes" icon={<Database className="h-3.5 w-3.5" />} scrollable>
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
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
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
        </TableCard>

        <TableCard title="Top Tables by Size" icon={<HardDrive className="h-3.5 w-3.5" />} scrollable>
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
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
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
        </TableCard>

        <TableCard title="Tables with Most Parts" icon={<Layers className="h-3.5 w-3.5" />} scrollable>
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
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
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
        </TableCard>

        <TableCard title="Top System Events" icon={<Activity className="h-3.5 w-3.5" />} scrollable>
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
        </TableCard>

        <TableCard title="System Metrics" icon={<Gauge className="h-3.5 w-3.5" />} scrollable>
          <div>
            {data.metrics.map((m, i) => (
              <div key={`${m.metric}-${m.host}-${i}`} className="flex items-center justify-between border-b border-[var(--color-border)] py-1.5 last:border-0">
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {m.metric.replace(/([A-Z])/g, " $1").trim()}
                  {(data.nodes?.length ?? 0) > 1 && <span className="ml-1 opacity-60">({m.host})</span>}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-primary)]">{formatEventValue(m.metric, m.value)}</span>
              </div>
            ))}
          </div>
        </TableCard>

        {data.replica_statuses.length > 0 && (
          <TableCard title="Replica Status" icon={<Server className="h-3.5 w-3.5" />} scrollable>
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
          </TableCard>
        )}

        {data.replication_queue.length > 0 && (
          <TableCard title="Replication Queue" icon={<AlertTriangle className="h-3.5 w-3.5" />} scrollable>
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
          </TableCard>
        )}
      </div>
    </PageContainer>
  );
}

interface Anomaly {
  severity: "warning" | "error";
  title: string;
  detail: string;
}

function AnomaliesAndWarningsCard({ data }: { data: DashboardData }) {
  const STORAGE_KEY = "ch-dashboard-action-items-collapsed";
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const anomalies: Anomaly[] = [];

  for (const w of data.warnings || []) {
    anomalies.push({ severity: "warning", title: "Configuration", detail: w });
  }

  for (const r of data.replica_statuses || []) {
    if (r.is_readonly === 1) {
      anomalies.push({
        severity: "error",
        title: "Read-only replica",
        detail: `${r.database}.${r.table} → ${r.replica_name} is in read-only state`,
      });
    }
    if (r.total_replicas > 0 && r.active_replicas < r.total_replicas) {
      anomalies.push({
        severity: "warning",
        title: "Inactive replicas",
        detail: `${r.database}.${r.table}: ${r.active_replicas}/${r.total_replicas} replicas active`,
      });
    }
    if (r.absolute_delay > 300) {
      anomalies.push({
        severity: "warning",
        title: "Replication lag",
        detail: `${r.database}.${r.table} → ${r.replica_name} is ${formatUptime(r.absolute_delay)} behind`,
      });
    }
    if (r.queue_size > 1000) {
      anomalies.push({
        severity: "warning",
        title: "Large replication queue",
        detail: `${r.database}.${r.table} → ${r.replica_name}: ${formatNumber(r.queue_size)} entries pending`,
      });
    }
  }

  for (const q of data.replication_queue || []) {
    if (q.num_tries > 5) {
      anomalies.push({
        severity: "warning",
        title: "Stuck replication task",
        detail: `${q.database}.${q.table}: ${q.type} failed ${q.num_tries} times — ${q.last_exception.slice(0, 100)}`,
      });
    }
  }

  for (const t of data.top_tables_by_parts || []) {
    if (t.parts > 1000) {
      anomalies.push({
        severity: "error",
        title: "Too many parts",
        detail: `${t.database}.${t.table}: ${formatNumber(t.parts)} parts (ClickHouse will refuse inserts above ~3000)`,
      });
    } else if (t.parts > 300) {
      anomalies.push({
        severity: "warning",
        title: "High parts count",
        detail: `${t.database}.${t.table}: ${formatNumber(t.parts)} parts — consider OPTIMIZE or longer part merge window`,
      });
    }
  }

  for (const ds of data.database_sizes || []) {
    if (ds.compressed_bytes > 1e9 && ds.uncompressed_bytes > 0) {
      const ratio = ds.uncompressed_bytes / ds.compressed_bytes;
      if (ratio < 1.2) {
        anomalies.push({
          severity: "warning",
          title: "Low compression ratio",
          detail: `${ds.database}: ${ratio.toFixed(2)}x compression (${formatBytes(ds.compressed_bytes)} / ${formatBytes(ds.uncompressed_bytes)}) — consider LowCardinality, codecs, or columnar optimization`,
        });
      }
    }
  }

  for (const n of data.nodes || []) {
    if (n.uptime < 3600) {
      anomalies.push({
        severity: "warning",
        title: "Recently restarted node",
        detail: `${n.host} uptime: ${formatUptime(n.uptime)}`,
      });
    }
  }

  if (anomalies.length === 0) return null;

  return (
    <Card className="p-4">
      <div
        className={`mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] ${collapsed ? "mb-0" : ""} cursor-pointer select-none hover:text-[var(--color-text-primary)]`}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        Action Items ({anomalies.length})
      </div>
      {!collapsed && (
        <ul className="space-y-2">
          {anomalies.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              {a.severity === "error" ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <div className="flex-1">
                <div className={`font-medium ${a.severity === "error" ? "text-rose-500" : "text-amber-500"}`}>
                  {a.title}
                </div>
                <div className="text-[var(--color-text-secondary)]">{a.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConnectionInfoCard({ data }: { data: DashboardData }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
        <Server className="h-3.5 w-3.5" />
        Connection
      </div>
      <div className="space-y-1.5">
        <InfoRow icon={<Network className="h-3 w-3" />} label="Host" value={data.host_name || "—"} />
        <InfoRow icon={<User className="h-3 w-3" />} label="User" value={data.user || "—"} />
        <InfoRow icon={<Database className="h-3 w-3" />} label="Database" value={data.database || "—"} />
        {data.is_cluster && (
          <InfoRow
            icon={<Network className="h-3 w-3" />}
            label="Cluster"
            value={<Badge variant="default">{data.cluster}</Badge>}
          />
        )}
        {data.nodes?.length > 1 && (
          <InfoRow
            icon={<Server className="h-3 w-3" />}
            label="Nodes"
            value={`${data.nodes.length} (${data.nodes[0].version})`}
          />
        )}
      </div>
    </Card>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] py-1 last:border-0">
      <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        {icon}
        {label}
      </span>
      <span className="font-mono text-xs text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

const LOG_TABLE_HINTS: Record<string, { purpose: string; config: string }> = {
  query_log: {
    purpose: "Query history, metrics, errors",
    config: `<query_log>
    <database>system</database>
    <table>query_log</table>
    <flush_interval_milliseconds>1000</flush_interval_milliseconds>
</query_log>`,
  },
  query_thread_log: {
    purpose: "Per-thread timing for flamegraphs",
    config: `<query_thread_log>
    <database>system</database>
    <table>query_thread_log</table>
    <flush_interval_milliseconds>1000</flush_interval_milliseconds>
</query_thread_log>`,
  },
  query_views_log: {
    purpose: "Materialized view execution traces",
    config: `<query_views_log>
    <database>system</database>
    <table>query_views_log</table>
    <flush_interval_milliseconds>1000</flush_interval_milliseconds>
</query_views_log>`,
  },
  query_metric_log: {
    purpose: "Per-second metric samples during query",
    config: `<query_metric_log>
    <database>system</database>
    <table>query_metric_log</table>
    <flush_interval_milliseconds>1000</flush_interval_milliseconds>
    <collect_interval_milliseconds>1000</collect_interval_milliseconds>
</query_metric_log>`,
  },
  trace_log: {
    purpose: "Sampling profiler data (required for flamegraphs)",
    config: `<trace_log>
    <database>system</database>
    <table>trace_log</table>
    <flush_interval_milliseconds>1000</flush_interval_milliseconds>
</trace_log>`,
  },
};

function LogTablesCard({ data }: { data: DashboardData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const tables = data.log_tables ?? [];
  if (tables.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
        <HardDrive className="h-3.5 w-3.5" />
        System Log Tables
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
              <th className="py-1.5 pr-3 text-left font-normal">Table</th>
              <th className="py-1.5 pr-3 text-left font-normal">Purpose</th>
              <th className="py-1.5 pr-3 text-right font-normal">Rows</th>
              <th className="py-1.5 pr-3 text-right font-normal">Size</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((lt) => {
              const hint = LOG_TABLE_HINTS[lt.table];
              const isExpanded = expanded === lt.table;
              const status = !lt.enabled ? "disabled" : lt.rows > 0 ? "ok" : "empty";
              return (
                <Fragment key={lt.table}>
                  <tr className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        {status === "ok" ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        ) : status === "empty" ? (
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-rose-500" />
                        )}
                        <span className="font-mono">{lt.table}</span>
                        {status === "disabled" && (
                          <button
                            onClick={() => setExpanded(isExpanded ? null : lt.table)}
                            className="ml-1 rounded px-1 text-[10px] text-[var(--color-accent)] hover:underline"
                          >
                            {isExpanded ? "hide" : "enable"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-[var(--color-text-secondary)]">{hint?.purpose ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {lt.enabled ? formatNumber(lt.rows) : "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {lt.enabled ? formatBytes(lt.compressed_bytes) : "—"}
                    </td>
                  </tr>
                  {isExpanded && hint && (
                    <tr className="border-b border-[var(--color-border)] last:border-0">
                      <td colSpan={4} className="bg-[var(--surface-elevated)] p-3">
                        <div className="mb-1 text-[10px] text-[var(--color-text-secondary)]">
                          Add to <code className="rounded bg-[var(--surface-base)] px-1">config.xml</code> and restart:
                        </div>
                        <pre className="overflow-x-auto rounded bg-[var(--surface-base)] p-2 font-mono text-[10px] text-[var(--color-text-primary)]">
                          {hint.config}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px] text-[var(--color-text-secondary)] opacity-70">
        Tables are created lazily — they materialize on first matching event.
      </div>
    </Card>
  );
}

const GOOD_SETTINGS: Record<string, string[]> = {
  log_queries: ["1"],
  log_query_threads: ["1"],
  log_query_views: ["1"],
  log_query_metrics: ["1"],
  allow_introspection_functions: ["1"],
};

function SettingsCard({ data }: { data: DashboardData }) {
  const settings = data.settings ?? [];
  if (settings.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
        <SettingsIcon className="h-3.5 w-3.5" />
        Key Settings
      </div>
      <div className="space-y-1">
        {settings.map((s) => {
          const expected = GOOD_SETTINGS[s.name];
          const isGood = !expected || expected.includes(s.value);
          return (
            <div key={s.name} className="flex items-center justify-between border-b border-[var(--color-border)] py-1 last:border-0">
              <span className="flex items-center gap-1.5 text-xs">
                {isGood ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-rose-500" />
                )}
                <span className="font-mono">{s.name}</span>
              </span>
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{s.value}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
