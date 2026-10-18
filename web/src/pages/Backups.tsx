import { useState, useEffect, useMemo, useCallback } from "react";
import { RefreshCw, Archive, Clock, Pause, Play, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { fetchBackups } from "../api/client";
import type { BackupEntry } from "../api/client";
import { usePollingQuery } from "@/hooks/usePollingQuery";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { StatCard } from "@/components/ui/card";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { formatBytes, formatDuration, formatNumber, formatDateTime } from "../utils";

/** Visual class of a backup status: dot color + label tone. */
function statusTone(status: string): { color: string; label: string } {
  switch (status) {
    case "BACKUP_CREATED":
    case "RESTORE_CREATED":
      return { color: "var(--color-success)", label: status };
    case "BACKUP_FAILED":
    case "RESTORE_FAILED":
      return { color: "var(--color-error)", label: status };
    case "CREATING":
    case "RESTORING":
      return { color: "var(--color-accent)", label: status };
    default:
      return { color: "var(--color-text-secondary)", label: status || "UNKNOWN" };
  }
}

function isRunning(status: string): boolean {
  return status === "CREATING" || status === "RESTORING";
}

function isRestore(status: string): boolean {
  return status.startsWith("RESTORE");
}

/** Parse ClickHouse "YYYY-MM-DD HH:MM:SS" into epoch ms (0 when unparseable). */
function parseChTime(s: string | undefined): number {
  if (!s) return 0;
  const ms = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(ms) ? 0 : ms;
}

/** Progress 0..1 of a running backup/restore; null when not computable.
 * system.backups exposes only read-side counters (files_read/bytes_read) —
 * restores report progress against the same totals. */
function progressOf(b: BackupEntry): number | null {
  if (!isRunning(b.status)) return null;
  if (b.total_size > 0) return Math.min(1, b.bytes_read / b.total_size);
  if (b.num_files > 0) return Math.min(1, b.files_read / b.num_files);
  return null;
}

/**
 * Backups page: BACKUP/RESTORE activity from system.backups — status, size,
 * live progress of in-flight operations, and failure reasons. Opt-in live
 * refresh, same lifecycle as the Merges page.
 */
export function Backups({ connected }: { connected: boolean }) {
  const [refreshInterval, setRefreshInterval] = useState(10);

  const fetcher = useCallback((signal: AbortSignal) => fetchBackups(200, signal), []);

  const {
    data,
    loading,
    error,
    canceled,
    elapsed,
    cancel,
    reload,
    live: autoRefresh,
    setLive: setAutoRefresh,
  } = usePollingQuery(fetcher, {
    enabled: connected,
    intervalMs: refreshInterval * 1000,
  });

  const backups = useMemo(() => data?.backups ?? [], [data]);

  // Live elapsed for the "in progress" card: re-render every second while
  // something is CREATING/RESTORING so the elapsed clock ticks.
  const [now, setNow] = useState(() => Date.now());
  const anyRunning = backups.some((b) => isRunning(b.status));
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const stats = useMemo(() => {
    let creating = 0, backupCreated = 0, backupFailed = 0, restoreActivity = 0, restoring = 0;
    let oldestRunningStart = 0;
    for (const b of backups) {
      if (b.status === "CREATING") creating++;
      else if (b.status === "BACKUP_CREATED") backupCreated++;
      else if (b.status === "BACKUP_FAILED") backupFailed++;
      if (isRestore(b.status)) restoreActivity++;
      if (b.status === "RESTORING") restoring++;
      if (isRunning(b.status)) {
        const start = parseChTime(b.start_time);
        if (start && (oldestRunningStart === 0 || start < oldestRunningStart)) oldestRunningStart = start;
      }
    }
    const runningElapsedMs = oldestRunningStart ? Math.max(0, now - oldestRunningStart) : 0;
    return { creating, backupCreated, backupFailed, restoreActivity, restoring, runningElapsedMs, running: creating + restoring };
    // `now` is a deliberate dependency: it drives the live elapsed display.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backups, now]);

  if (!connected) return <NotConnectedState />;

  return (
    <PageContainer>
      <PageHeader
        title="Backups"
        description="Backup & restore activity (system.backups) — read-only"
        actions={
          <>
            {loading && backups.length > 0 && <RefreshIndicator elapsed={elapsed} />}
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
            <Button variant="secondary" size="md" onClick={reload} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && backups.length > 0 && <div className="mb-4"><ErrorState error={error} onRetry={reload} /></div>}

      {loading && backups.length === 0 ? (
        <div className="py-4">
          <TableSkeleton rows={5} cols={6} />
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </div>
      ) : error && backups.length === 0 ? (
        <ErrorState error={error} onRetry={reload} />
      ) : canceled && backups.length === 0 ? (
        <LoadingNotice canceled onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label={stats.running > 0 ? `In progress (${stats.running})` : "In progress"}
              value={stats.running === 0 ? "0" : formatDuration(stats.runningElapsedMs)}
              icon={<Clock className="h-3 w-3" />}
              tone={stats.running > 0 ? "accent" : "default"}
            />
            <StatCard label="Backups created" value={formatNumber(stats.backupCreated)} icon={<CheckCircle2 className="h-3 w-3" />} tone={stats.backupCreated > 0 ? "success" : "default"} />
            <StatCard label="Backups failed" value={formatNumber(stats.backupFailed)} icon={<XCircle className="h-3 w-3" />} tone={stats.backupFailed > 0 ? "error" : "default"} />
            <StatCard label="Restore activity" value={formatNumber(stats.restoreActivity)} icon={<Archive className="h-3 w-3" />} />
          </div>

          {backups.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="No backups found"
              description="Run BACKUP/RESTORE statements in the SQL editor; they appear here from system.backups."
            />
          ) : (
            <div className="mt-4 max-h-[65vh] overflow-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Status</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Started</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Finished</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--color-text-secondary)]">Size</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Progress</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-text-secondary)]">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b, i) => {
                    const tone = statusTone(b.status);
                    const pct = progressOf(b);
                    const startMs = parseChTime(b.start_time);
                    const endMs = parseChTime(b.end_time);
                    const durationMs = startMs && endMs && endMs > startMs ? endMs - startMs : 0;
                    const running = isRunning(b.status);
                    return (
                      <tr key={`${b.id}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            {running ? (
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: tone.color }} />
                            ) : (
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.color }} />
                            )}
                            <span className="font-mono">{tone.label}</span>
                          </span>
                        </td>
                        <td className="max-w-[280px] px-4 py-3 font-mono text-xs">
                          <span className="block truncate" title={b.name}>{b.name}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-secondary)]">{formatDateTime(b.start_time)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                          {b.end_time ? (
                            <>
                              {formatDateTime(b.end_time)}
                              {durationMs > 0 && <span className="ml-1 opacity-70">({formatDuration(durationMs)})</span>}
                            </>
                          ) : running ? (
                            <span className="text-[var(--color-accent)]">running…</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                          {b.total_size > 0 ? formatBytes(b.total_size) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {pct !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                                <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.round(pct * 100)}%` }} />
                              </div>
                              <span className="font-mono text-xs text-[var(--color-text-secondary)]">{Math.round(pct * 100)}%</span>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--color-text-secondary)]">—</span>
                          )}
                        </td>
                        <td className="max-w-[240px] px-4 py-3 text-xs">
                          {b.error ? (
                            <span className="block truncate text-[var(--color-error)]" title={b.error}>{b.error}</span>
                          ) : (
                            <span className="text-[var(--color-text-secondary)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
