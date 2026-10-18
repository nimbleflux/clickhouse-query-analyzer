import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Layers, HardDrive, Rows3, FolderTree, RefreshCw } from "lucide-react";
import { fetchTableParts } from "../api/client";
import { usePollingQuery } from "@/hooks/usePollingQuery";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { formatBytes, formatNumber, formatDateTime } from "../utils";

/** Humanize a seconds age the way ops people read it: 45s / 3m / 2h / 5d. */
export function humanizeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const TOP_PARTITIONS = 15;

/**
 * Parts explorer: the active data parts of one table (system.parts). Answers
 * "why does this table have so many parts" — which partitions are fragmented,
 * how fresh the parts are, and how big they are. Reached from the schema
 * sidebar's parts link or directly via /tables/{db}/{table}/parts.
 */
export function TableParts({ connected }: { connected: boolean }) {
  const { db = "", table = "" } = useParams<{ db: string; table: string }>();

  const fetcher = useMemo(
    () => (signal: AbortSignal) => fetchTableParts(db, table, 500, signal),
    [db, table],
  );

  const { data, loading, error, canceled, elapsed, cancel, reload } = usePollingQuery(fetcher, {
    enabled: connected && !!db && !!table,
  });

  const parts = useMemo(() => data?.parts ?? [], [data]);
  const summary = data?.summary;
  const totalParts = data?.total_parts ?? 0;

  // Top partitions by part count (backend already sorts parts DESC).
  const topPartitions = useMemo(
    () => (summary?.per_partition ?? []).slice(0, TOP_PARTITIONS),
    [summary],
  );
  const maxPartitionParts = topPartitions[0]?.parts ?? 0;

  const partitionCount = summary?.per_partition?.length ?? 0;

  if (!connected) return <NotConnectedState />;

  return (
    <PageContainer>
      <PageHeader
        title={`${db}.${table}`}
        description="Active data parts (system.parts) — fragmentation and freshness"
        breadcrumb="Table parts"
        actions={
          <>
            {loading && parts.length > 0 && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={reload} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && parts.length === 0 ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && parts.length === 0 ? (
        <div className="py-4">
          <TableSkeleton rows={8} cols={6} />
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </div>
      ) : canceled && parts.length === 0 ? (
        <LoadingNotice canceled onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Active parts" value={formatNumber(summary?.parts ?? 0)} icon={<Layers className="h-3 w-3" />} />
            <StatCard label="Rows" value={formatNumber(summary?.rows ?? 0)} icon={<Rows3 className="h-3 w-3" />} />
            <StatCard label="Bytes on disk" value={formatBytes(summary?.bytes_on_disk ?? 0)} icon={<HardDrive className="h-3 w-3" />} />
            <StatCard label="Partitions" value={formatNumber(partitionCount)} icon={<FolderTree className="h-3 w-3" />} />
          </div>

          {parts.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No active parts"
              description={`Table "${db}.${table}" has no active parts — it may not exist, not be a MergeTree table, or be empty.`}
            />
          ) : (
            <>
              {topPartitions.length > 0 && (
                <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
                  <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Parts per partition{partitionCount > TOP_PARTITIONS ? ` (top ${TOP_PARTITIONS} of ${partitionCount})` : ""}
                  </h2>
                  <div className="flex flex-col gap-1.5">
                    {topPartitions.map((p) => (
                      <div key={p.partition} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate font-mono text-xs text-[var(--color-text-primary)]" title={p.partition}>
                          {p.partition}
                        </span>
                        <div className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-[var(--surface-hover)]">
                          <div
                            className="h-full rounded bg-[var(--color-accent)]"
                            style={{ width: `${maxPartitionParts > 0 ? Math.max(1, (p.parts / maxPartitionParts) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="w-14 shrink-0 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(p.parts)}</span>
                        <span className="w-20 shrink-0 text-right font-mono text-xs text-[var(--color-text-secondary)]" title="Rows in partition">
                          {formatNumber(p.rows)} rows
                        </span>
                        <span className="hidden w-20 shrink-0 text-right font-mono text-xs text-[var(--color-text-secondary)] sm:block" title="Bytes on disk in partition">
                          {formatBytes(p.bytes_on_disk)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {totalParts > parts.length && (
                <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                  Showing {formatNumber(parts.length)} of {formatNumber(totalParts)} parts (newest first).
                </p>
              )}

              <div className="mt-2 max-h-[55vh] overflow-auto rounded-lg border border-[var(--color-border)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Name</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Partition</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Rows</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Size</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Marks</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Age</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p, i) => (
                      <tr key={`${p.name}-${i}`} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]">
                        <td className="max-w-[320px] px-4 py-2 font-mono text-xs">
                          <span className="block truncate" title={p.name}>{p.name}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-[var(--color-text-secondary)]">{p.partition}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(p.rows)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatBytes(p.bytes_on_disk)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(p.marks)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]" title={`${formatNumber(p.age_seconds)}s`}>
                          {humanizeAge(p.age_seconds)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-[var(--color-text-secondary)]">{formatDateTime(p.modification_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </PageContainer>
  );
}
