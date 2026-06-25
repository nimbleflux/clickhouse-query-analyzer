import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, AlertTriangle, RefreshCw, CheckCircle2, ArrowRight, FlaskConical, Timer } from "lucide-react";
import { fetchDDL } from "../api/client";
import type { DDLStatus } from "../api/types";
import { ApiError } from "../api/errors";
import { formatDuration, formatNumber } from "../utils";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, NotConnectedState } from "@/components/ui/state";

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

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDDL(undefined, signal);
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

  if (!connected) return <NotConnectedState />;

  if (error && !data) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => load()} />
      </PageContainer>
    );
  }

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

          {data.distributed_ddl.length === 0 && data.recent_ddl.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No DDL activity"
              description="No ON CLUSTER DDL in the distributed queue and no recent schema operations in query_log."
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

function DistributedDDLCard({ entries }: { entries: DDLStatus["distributed_ddl"] }) {
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
              return (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="max-w-sm truncate py-1.5 font-mono text-xs" title={e.query}>{e.query}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecentDDLCard({ entries }: { entries: DDLStatus["recent_ddl"] }) {
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
            {entries.map((e, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="whitespace-nowrap py-1.5 text-xs text-[var(--color-text-secondary)]">{e.event_time}</td>
                <td className="py-1.5 font-mono text-xs">{e.query_kind}</td>
                <td className="max-w-md truncate py-1.5 font-mono text-xs text-[var(--color-text-secondary)]" title={e.query}>{e.query}</td>
                <td className={`py-1.5 text-right font-mono text-xs ${e.query_duration_ms > 60000 ? "text-[var(--color-warning)]" : ""}`}>
                  {formatDuration(e.query_duration_ms)}
                </td>
                <td className="py-1.5 text-xs text-[var(--color-text-secondary)]">{e.user}</td>
                <td className="py-1.5 text-xs">
                  {e.exception ? (
                    <Badge variant="error" className="max-w-xs truncate" title={e.exception}>failed</Badge>
                  ) : (
                    <span className="text-emerald-500">ok</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
