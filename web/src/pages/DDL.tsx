import { useState, useEffect, useCallback, memo } from "react";
import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, AlertTriangle, RefreshCw, CheckCircle2, ArrowRight, FlaskConical, Timer, ChevronRight, ChevronDown, Copy } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchDDL } from "../api/client";
import type { DDLStatus } from "../api/types";
import { ApiError } from "../api/errors";
import { formatDuration, formatNumber } from "../utils";
import { useTheme } from "../api/theme";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, NotConnectedState } from "@/components/ui/state";

const TIMEFRAMES: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "All", hours: 0 },
];

function statusTone(status: string, exception: string): { color: string; label: string } {
  if (exception) return { color: "text-[var(--color-error)]", label: "Failed" };
  switch (status) {
    case "Finished": return { color: "text-emerald-500", label: "Finished" };
    case "Active": return { color: "text-[var(--color-accent)]", label: "Active" };
    case "Inactive": return { color: "text-[var(--color-text-secondary)]", label: "Queued" };
    case "Removing": return { color: "text-[var(--color-warning)]", label: "Removing" };
    default: return { color: "text-[var(--color-warning)]", label: status || "Unknown" };
  }
}

export function DDL({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<DDLStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [hours, setHours] = useState(24);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDDL({ hours }, signal);
      setData(result);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, connected]);

  if (!connected) return <NotConnectedState />;

  if (error && !data) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => load()} />
      </PageContainer>
    );
  }

  const windowLabel = hours === 0 ? "all time" : `last ${hours < 24 ? `${hours}h` : hours < 168 ? `${hours / 24}d` : "7d"}`;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="DDL"
        description="Distributed DDL queue and recent schema operations"
        actions={
          <Button variant="secondary" size="md" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--color-text-secondary)]">Timeframe:</span>
        {TIMEFRAMES.map((tf) => (
          <Button
            key={tf.hours}
            variant={hours === tf.hours ? "primary" : "secondary"}
            size="sm"
            onClick={() => setHours(tf.hours)}
          >
            {tf.label}
          </Button>
        ))}
        <span className="text-xs text-[var(--color-text-secondary)]">
          Showing recent DDL for <span className="font-medium text-[var(--color-text-primary)]">{windowLabel}</span>
          {hours === 0 && <span className="ml-1">(queue is always current-state)</span>}
        </span>
      </div>

      {data?.partial_errors && data.partial_errors.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--state-warning)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
          <span>Some sections unavailable: {data.partial_errors.join(", ")}.</span>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <Timer className="h-3 w-3" /> Stuck DDL
              </div>
              <div className={`mt-1 font-mono text-lg font-semibold ${data.stuck_ddl > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-text-primary)]"}`}>
                {data.stuck_ddl}
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <AlertTriangle className="h-3 w-3" /> Failed DDL
              </div>
              <div className={`mt-1 font-mono text-lg font-semibold ${data.failed_ddl > 0 ? "text-[var(--color-error)]" : "text-[var(--color-text-primary)]"}`}>
                {data.failed_ddl}
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <Layers className="h-3 w-3" /> Queue Entries
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">
                {data.distributed_ddl.length}
              </div>
            </Card>
            <button
              onClick={() => navigate("/replication")}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4 text-left transition-colors hover:bg-[var(--surface-hover)]"
              title="View pending mutations on the Replication page"
            >
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <FlaskConical className="h-3 w-3" /> Pending Mutations
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">
                {formatNumber(data.pending_mutations)}
                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
              </div>
            </button>
          </div>

          {data.stuck_ddl > 0 && (
            <Card className="border-[var(--color-warning)]/30 p-4">
              <div className="flex items-center gap-2 text-xs text-[var(--color-warning)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {data.stuck_ddl} distributed DDL operation(s) are not finished — ON CLUSTER DDL may be stuck.
              </div>
            </Card>
          )}

          <DDLTrendChart trend={data.trend} hours={hours} />

          {data.distributed_ddl.length === 0 && data.recent_ddl.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No DDL activity"
              description={`No ON CLUSTER DDL in the distributed queue and no recent schema operations (${windowLabel}).`}
            />
          ) : (
            <>
              {data.distributed_ddl.length > 0 && <DistributedDDLCard entries={data.distributed_ddl} />}
              {data.recent_ddl.length > 0 && <RecentDDLCard entries={data.recent_ddl} />}
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}

const DDLTrendChart = memo(function DDLTrendChart({ trend, hours }: { trend: DDLStatus["trend"]; hours: number }) {
  const theme = useTheme();
  const isDark = theme === "dark";
  const gridColor = isDark ? "#334155" : "#e2e8f0";
  const textColor = isDark ? "#94a3b8" : "#64748b";
  const tooltipStyle = { background: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

  // DDL is sparse; hide the chart entirely when there's no activity in the
  // window rather than render an empty grid that reads as broken.
  const hasSignal = trend.some((p) => p.total > 0);
  if (!hasSignal) return null;

  const points = trend.map((p) => ({ bucket: p.bucket, ok: p.total - p.failed, failed: p.failed }));
  const fmtBucket = (v: string) => {
    try {
      const d = new Date(v.replace(" ", "T"));
      return hours <= 24
        ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return v;
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">DDL Operations (ok vs failed)</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={points}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis dataKey="bucket" tickFormatter={fmtBucket} tick={{ fill: textColor, fontSize: 10 }} interval="preserveStartEnd" minTickGap={40} />
          <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 10 }} width={28} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtBucket(String(l))} />
          <Bar dataKey="ok" stackId="a" fill="#10b98180" name="ok" radius={[0, 0, 0, 0]} />
          <Bar dataKey="failed" stackId="a" fill="#ef4444" name="failed" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
});

// Expanded query viewer: truncated text in the row, click to expand into a
// full-width syntax-highlighted (CodeMirror) view with a copy button. Only the
// expanded row pays for a CodeMirror instance, so large tables stay cheap.
function ExpandedQuery({ query, theme }: { query: string; theme: string }) {
  const copy = useCopyToClipboard();
  return (
    <div className="bg-[var(--surface-base)] p-2">
      <div className="mb-1 flex justify-end">
        <Button variant="ghost" size="icon-sm" onClick={() => copy(query, "Query copied!")} title="Copy query">
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      <CodeMirror
        value={query}
        extensions={[sql()]}
        theme={theme === "dark" ? oneDark : undefined}
        editable={false}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
        className="text-xs [&_.cm-editor]:!bg-transparent [&_.cm-content]:!p-0 [&_.cm-scroller]:!max-h-64 [&_.cm-scroller]:!overflow-auto [&_.cm-gutters]:!bg-transparent"
      />
    </div>
  );
}

function ExpandToggle({ open }: { open: boolean }) {
  return open
    ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
    : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />;
}

function DistributedDDLCard({ entries }: { entries: DDLStatus["distributed_ddl"] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <Card className="flex max-h-[32rem] flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
        <Layers className="h-3.5 w-3.5" />
        Distributed DDL Queue ({entries.length})
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Query</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Host</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Cluster</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Status</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Duration</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Created</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Exception</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const tone = statusTone(e.status, e.exception_text);
              const isOpen = expanded.has(i);
              return (
                <Fragment key={i}>
                  <tr
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
                    onClick={() => toggle(i)}
                  >
                    <td className="py-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <ExpandToggle open={isOpen} />
                        <span className="max-w-sm truncate font-mono" title={e.query}>{e.query}</span>
                      </div>
                    </td>
                    <td className="py-1.5 font-mono text-xs text-[var(--color-text-secondary)]">{e.initiator_host || "-"}</td>
                    <td className="py-1.5 font-mono text-xs text-[var(--color-text-secondary)]">{e.cluster || "-"}</td>
                    <td className={`py-1.5 font-mono text-xs ${tone.color}`}>
                      <span className="inline-flex items-center gap-1">
                        {tone.label === "Finished" ? <CheckCircle2 className="h-3 w-3" /> : null}
                        {tone.label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                      {e.query_duration_ms ? formatDuration(e.query_duration_ms) : "-"}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-xs text-[var(--color-text-secondary)]">{e.query_create_time}</td>
                    <td className="max-w-xs truncate py-1.5 text-xs text-[var(--color-error)]" title={e.exception_text}>
                      {e.exception_text || "-"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[var(--color-border)]">
                      <td colSpan={7}><ExpandedQuery query={e.query} theme={theme} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecentDDLCard({ entries }: { entries: DDLStatus["recent_ddl"] }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  return (
    <Card className="flex max-h-[32rem] flex-col">
      <div className="flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]">
        <Timer className="h-3.5 w-3.5" />
        Recent DDL Operations ({entries.length})
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Time</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Kind</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Query</th>
              <th className="pb-1.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Duration</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">User</th>
              <th className="pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const isOpen = expanded.has(i);
              return (
                <Fragment key={i}>
                  <tr
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
                    onClick={() => toggle(i)}
                  >
                    <td className="whitespace-nowrap py-1.5 text-xs text-[var(--color-text-secondary)]">{e.event_time}</td>
                    <td className="py-1.5 font-mono text-xs">{e.query_kind}</td>
                    <td className="py-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <ExpandToggle open={isOpen} />
                        <span className="max-w-md truncate font-mono text-[var(--color-text-secondary)]" title={e.query}>{e.query}</span>
                      </div>
                    </td>
                    <td className={`py-1.5 text-right font-mono text-xs ${e.query_duration_ms > 60000 ? "text-[var(--color-warning)]" : ""}`}>
                      {formatDuration(e.query_duration_ms)}
                    </td>
                    <td className="py-1.5 text-xs text-[var(--color-text-secondary)]">{e.user}</td>
                    <td className="py-1.5 text-xs">
                      {e.exception ? (
                        <Badge variant="error">failed</Badge>
                      ) : (
                        <Badge variant="success">ok</Badge>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[var(--color-border)]">
                      <td colSpan={6}>
                        <ExpandedQuery query={e.query} theme={theme} />
                        {e.exception && (
                          <div className="border-t border-[var(--color-border)] bg-[var(--state-error)] px-3 py-2 text-xs text-[var(--color-error)]">
                            {e.exception}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
