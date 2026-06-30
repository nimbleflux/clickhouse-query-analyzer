import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { RefreshCw, Search, Gauge } from "lucide-react";
import { fetchAsyncMetrics } from "../api/client";
import type { AsyncMetric } from "../api/types";
import { ApiError } from "../api/errors";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { formatNumber } from "../utils";

// Mirrors the backend MetricCategory heuristic so categories are stable between
// the two layers without an extra round-trip.
function category(metric: string): string {
  const m = metric;
  if (m.startsWith("OS")) return "OS";
  if (m.startsWith("Filesystem") || m.includes("Disk") || m.includes("disk_")) return "Disk";
  if (m.includes("Network") || m.includes("network_") || m.includes("Send") || m.includes("Receive")) return "Network";
  if (m.includes("CPU")) return "CPU";
  if (m.includes("Memory") || m.includes("memory")) return "Memory";
  if (m.endsWith("Cache") || m.includes("CacheSize") || m.includes("_cache")) return "Caches";
  if (m.includes("Dictionary") || m.includes("dictionary")) return "Dictionaries";
  if (m.includes("Replica") || m.includes("replicated") || m.includes("ZooKeeper") || m.includes("Keeper")) return "Replication";
  if (m.includes("Query") || m.includes("query") || m.includes("HTTP") || m.includes("Connection")) return "Server";
  return "Other";
}

// Choose a human format per metric name. Most are bytes/counts/seconds; fall
// back to formatNumber with up to 2 decimals for small fractional gauges.
function formatValue(metric: string, v: number): string {
  if (!Number.isFinite(v)) return "-";
  const m = metric;
  if (m.includes("Bytes") && !m.includes("Per")) return humanBytes(v);
  if (m.includes("Seconds") || m.includes("Time")) return `${v.toFixed(v < 10 ? 2 : 0)}s`;
  if (m.includes("Cache") && m.includes("Size")) return humanBytes(v);
  if (Number.isInteger(v) && Math.abs(v) >= 1000) return formatNumber(v);
  if (Math.abs(v) < 100) return v.toFixed(2);
  return formatNumber(v);
}

function humanBytes(b: number): string {
  if (!Number.isFinite(b)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let n = Math.abs(b);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

export function SystemMetrics({ connected }: { connected: boolean }) {
  const [metrics, setMetrics] = useState<AsyncMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedTimer(loading);

  const load = useCallback(async () => {
    setCanceled(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setMetrics(await fetchAsyncMetrics(controller.signal));
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { if (connected) load(); }, [load, connected]);
  const cancel = useCallback(() => { setCanceled(true); controllerRef.current?.abort(); setLoading(false); }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of metrics) set.add(category(m.metric));
    return ["", ...[...set].sort()];
  }, [metrics]);

  const filtered = useMemo(() => {
    let out = metrics;
    if (cat) out = out.filter((m) => category(m.metric) === cat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((m) => m.metric.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
    }
    return out;
  }, [metrics, cat, search]);

  if (!connected) return <NotConnectedState />;
  if (error && metrics.length === 0) return <PageContainer><ErrorState error={error} onRetry={load} /></PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="System Metrics"
        description="Live asynchronous gauges (system.asynchronous_metrics)"
        actions={
          <>
            {loading && metrics.length > 0 && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && metrics.length > 0 && <div className="mb-4"><ErrorState error={error} onRetry={load} /></div>}

      {loading && metrics.length === 0 ? (
        <div className="py-4">
          <TableSkeleton rows={8} cols={3} />
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </div>
      ) : canceled && metrics.length === 0 ? (
        <LoadingNotice canceled onRetry={load} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter metrics by name or description…" className="pl-9" />
            </div>
            <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-40">
              {categories.map((c) => <option key={c} value={c}>{c === "" ? "All categories" : c}</option>)}
            </Select>
            <span className="text-xs text-[var(--color-text-secondary)]">{filtered.length} shown</span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Gauge} title="No metrics match" description="Try clearing the search or category filter." />
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Value</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 1000).map((m) => (
                      <tr key={m.metric} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)]">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-[var(--color-text-primary)]">{m.metric}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatValue(m.metric, m.value)}</td>
                        <td className="max-w-md truncate px-4 py-2 text-xs text-[var(--color-text-secondary)]" title={m.description}>{m.description || "-"}</td>
                      </tr>
                    ))}
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
