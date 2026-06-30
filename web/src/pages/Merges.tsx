import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { RefreshCw, Search, Layers, GitMerge, HardDrive, Clock, Pause, Play } from "lucide-react";
import { fetchMerges } from "../api/client";
import type { MergeDetail } from "../api/types";
import { ApiError } from "../api/errors";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { formatBytes, formatDuration, formatNumber } from "../utils";

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold text-[var(--color-text-primary)]">{value}</div>
    </Card>
  );
}

export function Merges({ connected }: { connected: boolean }) {
  const [merges, setMerges] = useState<MergeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [search, setSearch] = useState("");
  const [minElapsed, setMinElapsed] = useState(0); // seconds; 0 = all
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedTimer(loading);

  const load = useCallback(async () => {
    setCanceled(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setMerges(await fetchMerges(controller.signal));
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { if (connected) load(); }, [load, connected]);

  useEffect(() => {
    if (!connected || !autoRefresh) return;
    intervalRef.current = setInterval(load, refreshInterval * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, refreshInterval, load, connected]);

  const cancel = useCallback(() => { setCanceled(true); controllerRef.current?.abort(); setLoading(false); }, []);

  const filtered = useMemo(() => {
    let out = merges;
    if (minElapsed > 0) out = out.filter((m) => m.elapsed >= minElapsed);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((m) => `${m.database}.${m.table}`.toLowerCase().includes(q) || m.result_part_name.toLowerCase().includes(q));
    }
    return out;
  }, [merges, minElapsed, search]);

  const stats = useMemo(() => {
    let bytes = 0, slowest = 0, mutations = 0;
    for (const m of merges) {
      bytes += m.total_size_bytes_compressed;
      if (m.elapsed > slowest) slowest = m.elapsed;
      if (m.is_mutation) mutations++;
    }
    return { total: merges.length, bytes, slowest, mutations };
  }, [merges]);

  if (!connected) return <NotConnectedState />;
  if (error && merges.length === 0) return <PageContainer><ErrorState error={error} onRetry={load} /></PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Merges"
        description="In-progress part merges (system.merges) — read-only"
        actions={
          <>
            {loading && merges.length > 0 && <RefreshIndicator elapsed={elapsed} />}
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
            <Button variant="secondary" size="md" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && merges.length > 0 && <div className="mb-4"><ErrorState error={error} onRetry={load} /></div>}

      {loading && merges.length === 0 ? (
        <div className="py-4">
          <TableSkeleton rows={5} cols={6} />
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </div>
      ) : canceled && merges.length === 0 ? (
        <LoadingNotice canceled onRetry={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Active merges" value={formatNumber(stats.total)} icon={GitMerge} />
            <StatCard label="Bytes merging" value={formatBytes(stats.bytes)} icon={HardDrive} />
            <StatCard label="Slowest" value={stats.slowest ? formatDuration(stats.slowest * 1000) : "-"} icon={Clock} />
            <StatCard label="Mutation merges" value={formatNumber(stats.mutations)} icon={Layers} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by table or result part…" className="pl-9" />
            </div>
            <Select value={minElapsed} onChange={(e) => setMinElapsed(Number(e.target.value))} className="w-32">
              <option value={0}>Any elapsed</option>
              <option value={60}>&gt; 1m</option>
              <option value={300}>&gt; 5m</option>
              <option value={900}>&gt; 15m</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={GitMerge}
              title={merges.length === 0 ? "No active merges" : "No merges match filters"}
              description={merges.length === 0 ? "Nothing merging right now." : "Try clearing the search."}
            />
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Table</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Progress</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Elapsed</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Parts</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Size</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m, i) => {
                      const pct = Math.round(m.progress * 100);
                      return (
                        <tr key={`${m.database}.${m.table}.${m.result_part_name}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                            <div className="flex items-center gap-1.5 text-[var(--color-text-primary)]">
                              <Layers className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" />
                              {m.database}.{m.table}
                            </div>
                            <div className="mt-0.5 truncate text-[var(--color-text-secondary)]" title={m.result_part_name}>→ {m.result_part_name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                                <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="font-mono text-xs text-[var(--color-text-secondary)]">{pct}%</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatDuration(m.elapsed * 1000)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(m.num_parts)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatBytes(m.total_size_bytes_compressed)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {m.is_mutation === 1 && <Badge variant="warning">mutation</Badge>}
                              <span className="text-xs text-[var(--color-text-secondary)]">{m.merge_type}/{m.merge_algorithm}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
