import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Server, AlertTriangle, RefreshCw, Network, Clock, ListChecks, FlaskConical, Pause, Play, KeyRound } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchReplication } from "../api/client";
import type { ReplicationStatus, ReplicationMetricPoint } from "../api/types";
import { ApiError } from "../api/errors";
import { formatNumber } from "../utils";
import { useTheme } from "../api/theme";
import { CardSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, NotConnectedState } from "@/components/ui/state";
import { ClusterNoteBanner } from "@/components/ClusterNoteBanner";

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "default" | "warning" | "error";
}

function StatCard({ label, value, icon, tone = "default" }: StatCardProps) {
  const color =
    tone === "error" ? "text-[var(--color-error)]" :
    tone === "warning" ? "text-[var(--color-warning)]" :
    "text-[var(--color-text-primary)]";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        {icon}
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>{value}</div>
    </Card>
  );
}

function formatDelay(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">{title}</div>
      {children}
    </Card>
  );
}

export function Replication({ connected }: { connected: boolean }) {
  const [data, setData] = useState<ReplicationStatus | null>(null);
  const [history, setHistory] = useState<ReplicationMetricPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Live refresh is opt-in: the page is heavy enough (charts + multi-table)
  // that silently polling every few seconds is a poor default. The user
  // clicks "Live" when they're actively watching a replication incident.
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(10);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const [database, setDatabase] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [executingOnly, setExecutingOnly] = useState(false);

  // includeHistory defaults to true: the initial load and manual refreshes
  // pull the 24h chart data. The auto-refresh tick passes false so live
  // polling only re-fetches the cheap live tables, not the (large) history.
  const load = useCallback(async (signal?: AbortSignal, includeHistory = true) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReplication(
        { database: database || undefined, errors_only: errorsOnly, executing_only: executingOnly, include_history: includeHistory },
        signal,
      );
      setData(result);
      if (includeHistory && result.metric_history?.length > 0) setHistory(result.metric_history);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      setLoading(false);
    }
  }, [database, errorsOnly, executingOnly]);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, connected]);

  useEffect(() => {
    if (!connected || !autoRefresh) return;
    const controller = new AbortController();
    intervalRef.current = setInterval(() => load(controller.signal, false), refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); controller.abort(); };
  }, [autoRefresh, refreshInterval, load, connected]);

  if (!connected) return <NotConnectedState />;

  if (error && !data) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => load()} />
      </PageContainer>
    );
  }

  const s = data?.summary;
  const databases = data ? [...new Set(data.replica_statuses.map((r) => r.database))].sort() : [];

  // Warn-level thresholds mirror the dashboard's anomaly logic so the two
  // views don't disagree on what "bad" means.
  const hasLag = (s?.max_absolute_delay ?? 0) > 300;
  const hasReadOnly = (s?.readonly_replicas ?? 0) > 0;
  const hasStuck = (s?.stuck_tasks ?? 0) > 0;
  const hasPendingMut = (s?.pending_mutations ?? 0) > 0;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Replication"
        description="Replica status, queue depth, and pending mutations"
        actions={
          <>
            <Select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              disabled={!autoRefresh}
              className={!autoRefresh ? "opacity-50" : ""}
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </Select>
            <Button variant={autoRefresh ? "primary" : "secondary"} size="md" onClick={() => setAutoRefresh(!autoRefresh)}>
              {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              Live
            </Button>
            <Button variant="secondary" size="md" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {data?.partial_errors && data.partial_errors.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--state-warning)] px-4 py-2 text-xs text-[var(--color-text-secondary)]"
          title={data.partial_errors.map((t) => `${t}: ${data.partial_error_details?.[t] ?? ""}`).join("\n")}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
          <span>Some sections are unavailable — your ClickHouse user may lack access to: {data.partial_errors.join(", ")}. Hover for details.</span>
        </div>
      )}

      <ClusterNoteBanner note={data?.cluster_note} />

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Queue Depth"
              value={formatNumber(s?.total_queue_depth ?? 0)}
              icon={<ListChecks className="h-3 w-3" />}
              tone={(s?.total_queue_depth ?? 0) > 1000 ? "warning" : "default"}
            />
            <StatCard
              label="Max Lag"
              value={formatDelay(s?.max_absolute_delay ?? 0)}
              icon={<Clock className="h-3 w-3" />}
              tone={hasLag ? "error" : "default"}
            />
            <StatCard
              label="Read-only"
              value={formatNumber(s?.readonly_replicas ?? 0)}
              icon={<AlertTriangle className="h-3 w-3" />}
              tone={hasReadOnly ? "error" : "default"}
            />
            <StatCard
              label="Stuck Tasks"
              value={formatNumber(s?.stuck_tasks ?? 0)}
              icon={<AlertTriangle className="h-3 w-3" />}
              tone={hasStuck ? "warning" : "default"}
            />
            <StatCard
              label="Mutations"
              value={formatNumber(s?.pending_mutations ?? 0)}
              icon={<FlaskConical className="h-3 w-3" />}
              tone={hasPendingMut ? "warning" : "default"}
            />
            <KeeperCard keeper={data.keeper} />
          </div>

          {(hasLag || hasReadOnly || hasStuck || hasPendingMut) && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
                <span className="font-medium text-[var(--color-text-secondary)]">Action items:</span>
                {hasReadOnly && <Badge variant="error">{s?.readonly_replicas} read-only replica(s)</Badge>}
                {hasLag && <Badge variant="warning">Lag {formatDelay(s?.max_absolute_delay ?? 0)} (&gt;300s)</Badge>}
                {hasStuck && <Badge variant="warning">{s?.stuck_tasks} stuck task(s) (num_tries &gt; 3)</Badge>}
                {hasPendingMut && <Badge variant="warning">{s?.pending_mutations} pending mutation(s)</Badge>}
              </div>
            </Card>
          )}

          <MetricCharts history={history} />

          <div className="flex flex-wrap items-center gap-2">
            <Select value={database} onChange={(e) => setDatabase(e.target.value)} className="min-w-[180px]">
              <option value="">All databases</option>
              {databases.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
            <Button
              variant={errorsOnly ? "primary" : "secondary"}
              size="md"
              onClick={() => setErrorsOnly((v) => !v)}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Errors only
            </Button>
            <Button
              variant={executingOnly ? "primary" : "secondary"}
              size="md"
              onClick={() => setExecutingOnly((v) => !v)}
            >
              Executing
            </Button>
          </div>

          {data.replica_statuses.length === 0 &&
           data.replication_queue.length === 0 &&
           data.mutations.length === 0 ? (
            data.partial_errors.length > 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load replication data"
                description="Your ClickHouse user may lack SELECT access to the required system tables (listed above). Contact your ClickHouse admin to grant access, or reconnect with an authorized user."
              />
            ) : (
              <EmptyState
                icon={Network}
                title="No replicated tables found"
                description="This ClickHouse instance has no ReplicatedMergeTree tables registered in system.replicas."
              />
            )
          ) : (
            <>
              {data.replica_statuses.length > 0 && (
                <ReplicaStatusCard replicas={data.replica_statuses} />
              )}
              {data.replication_queue.length > 0 && (
                <ReplicationQueueCard queue={data.replication_queue} />
              )}
              {data.mutations.length > 0 && (
                <MutationsCard mutations={data.mutations} />
              )}
            </>
          )}
        </>
      ) : null}
    </PageContainer>
  );
}

function ReplicaStatusCard({ replicas }: { replicas: ReplicationStatus["replica_statuses"] }) {
  return (
    <Card className="flex max-h-[28rem] flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
        <Server className="h-3.5 w-3.5" />
        Replica Status ({replicas.length})
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Replica</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Leader</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Delay</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Log Lag</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Queue</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Age</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Active</th>
            </tr>
          </thead>
          <tbody>
            {replicas.map((r, i) => {
              const logLag = Math.max(0, r.log_max_index - r.log_pointer);
              const queueAge = r.queue_oldest_time ? Math.max(0, Math.round((Date.now() - new Date(r.queue_oldest_time.replace(" ", "T")).getTime()) / 1000)) : 0;
              return (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1.5 text-xs">
                    <span className="text-[var(--color-text-secondary)]">{r.database}.</span>{r.table}
                  </td>
                  <td className="py-1.5 font-mono text-xs text-[var(--color-text-secondary)]">
                    {r.replica_name}
                    {r.is_session_expired ? <span className="ml-1 text-[var(--color-error)]" title="Keeper session expired">⚠</span> : null}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {r.is_leader ? <span className="text-[var(--color-accent)]">Yes</span> : "-"}
                  </td>
                  <td className={`py-1.5 text-right font-mono text-xs ${r.absolute_delay > 300 ? "text-[var(--color-error)]" : r.absolute_delay > 60 ? "text-[var(--color-warning)]" : ""}`}>
                    {formatDelay(r.absolute_delay)}
                  </td>
                  <td className={`py-1.5 text-right font-mono text-xs ${logLag > 0 ? "text-[var(--color-warning)]" : ""}`}>
                    {logLag > 0 ? formatNumber(logLag) : "-"}
                  </td>
                  <td className={`py-1.5 text-right font-mono text-xs ${r.queue_size > 1000 ? "text-[var(--color-warning)]" : ""}`}>
                    {r.queue_size || "-"}
                  </td>
                  <td className={`py-1.5 text-right font-mono text-xs ${queueAge > 300 ? "text-[var(--color-warning)]" : ""}`}>
                    {queueAge > 0 ? formatDelay(queueAge) : "-"}
                  </td>
                  <td className={`py-1.5 text-right font-mono text-xs ${r.total_replicas > 0 && r.active_replicas < r.total_replicas ? "text-[var(--color-warning)]" : ""}`}>
                    {r.active_replicas}/{r.total_replicas}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ReplicationQueueCard({ queue }: { queue: ReplicationStatus["replication_queue"] }) {
  return (
    <Card className="flex max-h-[28rem] flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
        <AlertTriangle className="h-3.5 w-3.5" />
        Replication Queue ({queue.length})
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Replica</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Type</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Run</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Tries</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Created</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Source</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Postponed</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Last error</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1.5 text-xs">
                  <span className="text-[var(--color-text-secondary)]">{q.database}.</span>{q.table}
                </td>
                <td className="py-1.5 font-mono text-xs text-[var(--color-text-secondary)]">{q.replica_name}</td>
                <td className="py-1.5 text-right font-mono text-xs">{q.type}</td>
                <td className="py-1.5 text-right font-mono text-xs">
                  {q.is_currently_executing ? <span className="text-[var(--color-accent)]">running</span> : "idle"}
                </td>
                <td className={`py-1.5 text-right font-mono text-xs ${q.num_tries > 3 ? "text-[var(--color-error)]" : q.num_tries > 0 ? "text-[var(--color-warning)]" : ""}`}>
                  {q.num_tries || "-"}
                </td>
                <td className="whitespace-nowrap py-1.5 text-xs text-[var(--color-text-secondary)]">{q.create_time}</td>
                <td className="py-1.5 font-mono text-xs text-[var(--color-text-secondary)]">{q.source_replica || "-"}</td>
                <td className="py-1.5 text-xs text-[var(--color-text-secondary)]" title={q.postpone_reason}>
                  {q.num_postponed > 0 ? <span className="text-[var(--color-warning)]">{q.num_postponed}× {q.postpone_reason || ""}</span> : "-"}
                </td>
                <td className="max-w-sm truncate py-1.5 text-xs text-[var(--color-error)]" title={q.last_exception}>
                  {q.last_exception || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MutationsCard({ mutations }: { mutations: ReplicationStatus["mutations"] }) {
  return (
    <Card className="flex max-h-[28rem] flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
        <FlaskConical className="h-3.5 w-3.5" />
        Pending Mutations ({mutations.length})
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Table</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Mutation</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Parts to do</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Created</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Latest failure</th>
            </tr>
          </thead>
          <tbody>
            {mutations.map((m, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="py-1.5 text-xs">
                  <span className="text-[var(--color-text-secondary)]">{m.database}.</span>{m.table}
                </td>
                <td className="max-w-md truncate py-1.5 font-mono text-xs text-[var(--color-text-secondary)]" title={m.command}>{m.command}</td>
                <td className={`py-1.5 text-right font-mono text-xs ${m.parts_to_do > 0 ? "text-[var(--color-warning)]" : ""}`}>
                  {m.parts_to_do}
                </td>
                <td className="whitespace-nowrap py-1.5 text-xs text-[var(--color-text-secondary)]">{m.create_time}</td>
                <td className="max-w-sm truncate py-1.5 text-xs text-[var(--color-error)]" title={m.latest_fail_reason}>
                  {m.latest_fail_reason || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function KeeperCard({ keeper }: { keeper: ReplicationStatus["keeper"] }) {
  const expired = keeper.some((k) => k.is_expired);
  const connected = keeper.length > 0 && !expired;
  const maxUptime = keeper.reduce((m, k) => Math.max(m, k.session_uptime_seconds), 0);
  const tone = expired ? "error" : connected ? "default" : "warning";
  const color =
    tone === "error" ? "text-[var(--color-error)]" :
    tone === "warning" ? "text-[var(--color-warning)]" :
    "text-[var(--color-text-primary)]";
  const value = expired ? "EXPIRED" : connected ? formatDelay(maxUptime) : "offline";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <KeyRound className="h-3 w-3" />
        Keeper
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>{value}</div>
    </Card>
  );
}

// Memoized: history only changes on initial load / manual refresh (the
// auto-refresh tick skips it), so the charts don't re-render every few seconds
// while the live tables update around them.
const MetricCharts = memo(function MetricCharts({ history }: { history: ReplicationMetricPoint[] }) {
  const theme = useTheme();
  const isDark = theme === "dark";
  const gridColor = isDark ? "#334155" : "#e2e8f0";
  const textColor = isDark ? "#94a3b8" : "#64748b";
  const tooltipStyle = { background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

  // Hide when metric_log is absent or entirely flat — a wall of zero-lines on
  // an idle cluster reads as broken rather than healthy. Any nonzero sample
  // (e.g. a live Keeper session) is enough signal to render.
  const hasSignal = history.some((p) =>
    p.readonly_replica || p.replicated_fetch || p.replicated_send ||
    p.replicated_checks || p.zk_session || p.zk_session_expired);
  if (!hasSignal) return null;

  const fmtTime = (v: string) => {
    try {
      return new Date(v.replace(" ", "T")).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return v;
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <ChartCard title="Read-only Replicas (24h)">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="event_time" tickFormatter={fmtTime} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 10 }} width={28} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} />
            <Area type="monotone" dataKey="readonly_replica" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} name="Read-only" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Replication Ops (24h)">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="event_time" tickFormatter={fmtTime} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 10 }} width={28} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} />
            <Area type="monotone" dataKey="replicated_fetch" stackId="a" stroke="#3b82f6" fill="#3b82f640" strokeWidth={1} name="Fetch" />
            <Area type="monotone" dataKey="replicated_send" stackId="a" stroke="#10b981" fill="#10b98140" strokeWidth={1} name="Send" />
            <Area type="monotone" dataKey="replicated_checks" stackId="a" stroke="#f59e0b" fill="#f59e0b40" strokeWidth={1} name="Checks" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Keeper Session (24h)">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="event_time" tickFormatter={fmtTime} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 10 }} width={28} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtTime(String(l))} />
            <Area type="monotone" dataKey="zk_session" stroke="#3b82f6" fill="#3b82f620" strokeWidth={1.5} name="Sessions" />
            <Area type="monotone" dataKey="zk_session_expired" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} name="Expired" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
});
