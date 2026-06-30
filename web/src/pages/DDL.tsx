import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, AlertTriangle, RefreshCw, CheckCircle2, ArrowRight, FlaskConical, Timer, ChevronRight, ChevronDown, Copy } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { format as formatSQL } from "sql-formatter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchDDL } from "../api/client";
import type { DDLStatus } from "../api/types";
import { ApiError } from "../api/errors";
import { formatDuration, formatNumber } from "../utils";
import { useTheme } from "../api/theme";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { useTableSort, SortableHeader } from "@/components/ui/table-sort";
import { ClusterNoteBanner } from "@/components/ClusterNoteBanner";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";

const TIMEFRAMES: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "All", hours: 0 },
];

// Minimal SQL keyword set for the inline (pre-expand) preview highlighter.
// CodeMirror is too heavy to mount on every row; this regex tokenizer is
// cheap enough for tables with hundreds of rows and gives the same look.
const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "CREATE", "TABLE", "ALTER", "DROP", "INSERT", "INTO",
  "VALUES", "UPDATE", "SET", "DELETE", "AND", "OR", "NOT", "NULL", "ON", "CLUSTER",
  "ENGINE", "ORDER", "BY", "GROUP", "PARTITION", "PRIMARY", "KEY", "INDEX", "JOIN",
  "LEFT", "RIGHT", "INNER", "OUTER", "AS", "DISTINCT", "LIMIT", "OFFSET", "UNION",
  "ALL", "HAVING", "ASC", "DESC", "SETTINGS", "IF", "EXISTS", "RENAME", "TO", "ADD",
  "COLUMN", "MODIFY", "ATTACH", "DETACH", "TRUNCATE", "WITH", "MATERIALIZED",
  "DEFAULT", "MERGETREE", "REPLICATEDMERGETREE", "REPLACE", "GRANT", "REVOKE",
]);

const TOKEN_RE = /(\/\*[\s\S]*?\*\/|--[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_])/g;

function highlightSQL(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1]) out.push(<span key={i++} className="italic text-[var(--color-text-secondary)]">{m[1]}</span>);
    else if (m[2]) out.push(<span key={i++} className="text-emerald-500">{m[2]}</span>);
    else if (m[3]) out.push(<span key={i++} className="text-purple-500">{m[3]}</span>);
    else if (m[4]) {
      const upper = m[4].toUpperCase();
      out.push(SQL_KEYWORDS.has(upper)
        ? <span key={i++} className="font-medium text-[var(--color-accent)]">{m[4]}</span>
        : <span key={i++}>{m[4]}</span>);
    } else {
      out.push(<span key={i++}>{m[0]}</span>);
    }
  }
  return out;
}

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

// Age of the oldest non-Finished distributed entry, for the stuck warning. The
// stuck count itself is backend-authoritative (age + exception rule in ddl.go);
// this just surfaces how long the oldest one has been sitting.
function oldestUnfinishedAgeSec(entries: DDLStatus["distributed_ddl"]): number {
  let max = 0;
  for (const e of entries) {
    if (e.status === "Finished") continue;
    const t = new Date(e.query_create_time.replace(" ", "T")).getTime();
    if (Number.isFinite(t)) max = Math.max(max, (Date.now() - t) / 1000);
  }
  return max;
}

export function DDL({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const [data, setData] = useState<DDLStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [hours, setHours] = useState(24);
  const controllerRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedTimer(loading);

  const load = useCallback(async (signal?: AbortSignal) => {
    setCanceled(false);
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
    controllerRef.current = controller;
    load(controller.signal);
    return () => controller.abort();
  }, [load, connected]);

  const cancel = useCallback(() => {
    setCanceled(true);
    controllerRef.current?.abort();
  }, []);

  if (!connected) return <NotConnectedState />;

  if (error && !data) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => load()} />
      </PageContainer>
    );
  }

  const windowLabel = hours === 0 ? "all time" : `last ${hours < 24 ? `${hours}h` : hours < 168 ? `${hours / 24}d` : "7d"}`;
  const stuckOldestAgeSec = data && data.stuck_ddl > 0 ? oldestUnfinishedAgeSec(data.distributed_ddl) : 0;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="DDL"
        description="Distributed DDL queue and recent schema operations"
        actions={
          <>
            {loading && data && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--color-text-secondary)]">Timeframe:</span>
        <TimeframeSelector
          options={TIMEFRAMES.map((tf) => ({ label: tf.label, value: tf.hours }))}
          value={hours}
          onChange={setHours}
        />
        <span className="text-xs text-[var(--color-text-secondary)]">
          Showing recent DDL for <span className="font-medium text-[var(--color-text-primary)]">{windowLabel}</span>
          {hours === 0 && <span className="ml-1">(queue is always current-state)</span>}
        </span>
      </div>

      {data?.partial_errors && data.partial_errors.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--state-warning)] px-4 py-2 text-xs text-[var(--color-text-secondary)]"
          title={data.partial_errors.map((t) => `${t}: ${data.partial_error_details?.[t] ?? ""}`).join("\n")}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
          <span>Some sections are unavailable ({data.partial_errors.join(", ")}). Hover for details.</span>
        </div>
      )}

      <ClusterNoteBanner note={data?.cluster_note} />

      {loading && !data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
          </div>
          <Card className="p-4"><TableSkeleton rows={6} cols={7} /></Card>
          <Card className="p-4"><TableSkeleton rows={6} cols={6} /></Card>
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </>
      ) : canceled && !data ? (
        <LoadingNotice canceled onRetry={() => load()} />
      ) : data ? (
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
              className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4 text-left transition-colors hover:bg-[var(--surface-hover)]"
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
                {data.stuck_ddl} distributed DDL operation(s) unfinished for &gt;10 min (or failed)
                {stuckOldestAgeSec > 0 ? <>; oldest pending {formatDuration(stuckOldestAgeSec * 1000)}</> : null}
                — ON CLUSTER DDL may be stuck.
              </div>
            </Card>
          )}

          <DDLTrendChart trend={data.trend} hours={hours} />

          {data.distributed_ddl.length === 0 && data.recent_ddl.length === 0 ? (
            data.partial_errors.length > 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load DDL data"
                description="Your ClickHouse user may lack SELECT access to the required system tables (listed above). Contact your ClickHouse admin to grant access, or reconnect with an authorized user."
              />
            ) : (
              <EmptyState
                icon={Layers}
                title="No DDL activity"
                description={`No ON CLUSTER DDL in the distributed queue and no recent schema operations (${windowLabel}).`}
              />
            )
          ) : (
            <>
              {data.distributed_ddl.length > 0 && <DistributedDDLCard entries={data.distributed_ddl} />}
              {data.recent_ddl.length > 0 && <RecentDDLCard entries={data.recent_ddl} />}
            </>
          )}
        </>
      ) : null}
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
          <Tooltip contentStyle={tooltipStyle} cursor={false} labelFormatter={(l) => fmtBucket(String(l))} />
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
  const [view, setView] = useState<"formatted" | "raw">("formatted");
  // Pretty-print the DDL; ClickHouse SQL is closest to the PostgreSQL dialect
  // in sql-formatter. Fall back to raw on parse failure.
  const formatted = useMemo(() => {
    try {
      return formatSQL(query, { language: "postgresql", keywordCase: "upper" });
    } catch {
      return query;
    }
  }, [query]);
  const value = view === "formatted" ? formatted : query;
  return (
    <div className="bg-[var(--surface-base)] p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant={view === "formatted" ? "secondary" : "ghost"} size="sm" onClick={() => setView("formatted")}>Formatted</Button>
          <Button variant={view === "raw" ? "secondary" : "ghost"} size="sm" onClick={() => setView("raw")}>Raw</Button>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => copy(value, "Query copied!")} title="Copy shown query">
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      <CodeMirror
        value={value}
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

type DistDDLSortField = "created" | "duration" | "status" | "host" | "cluster";

function DistributedDDLCard({ entries }: { entries: DDLStatus["distributed_ddl"] }) {
  const theme = useTheme();
  const sort = useTableSort<DistDDLSortField>("created", "desc");
  // Tag each row with its original array index: a stable, always-unique id. The
  // same ON CLUSTER DDL can appear on multiple replicas with identical selected
  // columns, so any data-derived key collides and makes React duplicate rows
  // when a sort reorders them. The index survives re-sorts and stays tied to
  // the right row, so expand-state is preserved correctly.
  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return entries
      .map((entry, id) => ({ entry, id }))
      .sort((a, b) => {
        let r = 0;
        switch (sort.field) {
          case "created": r = (a.entry.query_create_time || "").localeCompare(b.entry.query_create_time || ""); break;
          case "duration": r = a.entry.query_duration_ms - b.entry.query_duration_ms; break;
          case "status": r = (a.entry.status || "").localeCompare(b.entry.status || ""); break;
          case "host": r = (a.entry.initiator_host || "").localeCompare(b.entry.initiator_host || ""); break;
          case "cluster": r = (a.entry.cluster || "").localeCompare(b.entry.cluster || ""); break;
        }
        return r * dir;
      });
  }, [entries, sort.field, sort.dir]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Card className="flex max-h-[32rem] flex-col">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
          <Layers className="h-3.5 w-3.5" />
          Distributed DDL Queue ({entries.length})
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
          ON CLUSTER statements dispatched across the cluster. Anything not “Finished” is stuck or in-flight.
        </div>
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[15%]" /><col className="w-[31%]" /><col className="w-[9%]" /><col className="w-[8%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[15%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <SortableHeader className="px-3 pb-1.5 text-xs" field="created" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Created" />
              <th className="px-3 pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Query</th>
              <SortableHeader className="px-3 pb-1.5 text-xs" field="status" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Status" />
              <SortableHeader className="px-3 pb-1.5 text-xs" align="right" field="duration" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Duration" />
              <SortableHeader className="px-3 pb-1.5 text-xs" field="host" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Host" />
              <SortableHeader className="px-3 pb-1.5 text-xs" field="cluster" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Cluster" />
              <th className="px-3 pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Exception</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ entry: e, id }) => {
              const tone = statusTone(e.status, e.exception_text);
              const isOpen = expanded.has(id);
              return (
                <Fragment key={id}>
                  <tr
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
                    onClick={() => toggle(id)}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-[var(--color-text-primary)]">{e.query_create_time}</td>
                    <td className="px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <ExpandToggle open={isOpen} />
                        <span className="min-w-0 truncate font-mono" title={e.query}>{highlightSQL(e.query)}</span>
                      </div>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs ${tone.color}`}>
                      <span className="inline-flex items-center gap-1">
                        {tone.label === "Finished" ? <CheckCircle2 className="h-3 w-3" /> : null}
                        {tone.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-primary)]">
                      {e.query_duration_ms ? formatDuration(e.query_duration_ms) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-text-primary)]">
                      <span className="block truncate font-mono" title={e.initiator_host}>{e.initiator_host || "-"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-text-primary)]">
                      <span className="block truncate font-mono" title={e.cluster}>{e.cluster || "-"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-[var(--color-error)]" title={e.exception_text}>
                      <span className="block truncate">{e.exception_text || "-"}</span>
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

type RecentDDLSortField = "time" | "duration" | "status" | "kind" | "user";

function RecentDDLCard({ entries }: { entries: DDLStatus["recent_ddl"] }) {
  const theme = useTheme();
  const sort = useTableSort<RecentDDLSortField>("time", "desc");
  // Index-tagged rows (see DistributedDDLCard): query_log is read cluster-wide,
  // so query_id isn't guaranteed unique across replicas and a data-derived key
  // can collide on sort.
  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return entries
      .map((entry, id) => ({ entry, id }))
      .sort((a, b) => {
        let r = 0;
        switch (sort.field) {
          case "time": r = (a.entry.event_time || "").localeCompare(b.entry.event_time || ""); break;
          case "duration": r = a.entry.query_duration_ms - b.entry.query_duration_ms; break;
          case "status": r = (a.entry.exception ? 1 : 0) - (b.entry.exception ? 1 : 0); break;
          case "kind": r = (a.entry.query_kind || "").localeCompare(b.entry.query_kind || ""); break;
          case "user": r = (a.entry.user || "").localeCompare(b.entry.user || ""); break;
        }
        return r * dir;
      });
  }, [entries, sort.field, sort.dir]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Card className="flex max-h-[32rem] flex-col">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
          <Timer className="h-3.5 w-3.5" />
          Recent DDL Operations ({entries.length})
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
          Recent CREATE / ALTER / DROP (and similar) statements from query_log on this node.
        </div>
      </div>
      <div className="overflow-auto px-4 pb-4">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[15%]" /><col className="w-[47%]" /><col className="w-[10%]" /><col className="w-[10%]" /><col className="w-[8%]" /><col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <SortableHeader className="px-3 pb-1.5 text-xs" field="time" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Time" />
              <th className="px-3 pb-1.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Query</th>
              <SortableHeader className="px-3 pb-1.5 text-xs" field="status" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Status" />
              <SortableHeader className="px-3 pb-1.5 text-xs" align="right" field="duration" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Duration" />
              <SortableHeader className="px-3 pb-1.5 text-xs" field="kind" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Kind" />
              <SortableHeader className="px-3 pb-1.5 text-xs" field="user" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="User" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ entry: e, id }) => {
              const isOpen = expanded.has(id);
              return (
                <Fragment key={id}>
                  <tr
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]"
                    onClick={() => toggle(id)}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-[var(--color-text-primary)]">{e.event_time}</td>
                    <td className="px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <ExpandToggle open={isOpen} />
                        <span className="min-w-0 truncate font-mono" title={e.query}>{highlightSQL(e.query)}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                      {e.exception ? (
                        <Badge variant="error">failed</Badge>
                      ) : (
                        <Badge variant="success">ok</Badge>
                      )}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs ${e.query_duration_ms > 60000 ? "text-[var(--color-warning)]" : ""}`}>
                      {formatDuration(e.query_duration_ms)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{e.query_kind}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-[var(--color-text-primary)]">{e.user}</td>
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
