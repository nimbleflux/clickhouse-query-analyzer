import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Skull, MemoryStick, Database, RefreshCw, Pause } from "lucide-react";
import { fetchProcesses, killProcess } from "../api/client";
import type { ProcessEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, durationColor, memoryColor } from "../utils";

export function RunningQueries() {
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [killing, setKilling] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchProcesses();
      setProcesses(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load processes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 3000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
    return () => {};
  }, [autoRefresh, load]);

  const handleKill = async (queryId: string) => {
    setKilling((prev) => new Set(prev).add(queryId));
    try {
      await killProcess(queryId);
      setTimeout(load, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to kill query");
    } finally {
      setKilling((prev) => {
        const next = new Set(prev);
        next.delete(queryId);
        return next;
      });
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-[var(--color-text-secondary)]" />
          <h2 className="text-lg font-semibold">Running Queries</h2>
          <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-medium text-white">
            {processes.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors ${
              autoRefresh
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: "3s" } : undefined} />
            Live
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--color-error)] bg-red-900/20 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {loading && processes.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">Loading running queries...</div>
      ) : processes.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <Activity className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p>No running queries</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]">
                <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Duration</th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Memory</th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Peak Memory</th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Rows Read</th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Data Read</th>
                <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">User</th>
                <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">Query</th>
                <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]"></th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => (
                <tr
                  key={p.query_id}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <td className={`whitespace-nowrap px-4 py-3 font-mono ${durationColor(p.query_duration_ms)}`}>
                    {formatDuration(p.query_duration_ms)}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-mono ${memoryColor(p.memory_usage)}`}>
                    <div className="flex items-center justify-end gap-1">
                      <MemoryStick className="h-3 w-3" />
                      {formatBytes(p.memory_usage)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                    {formatBytes(p.peak_memory_usage)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                    {formatNumber(p.read_rows)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[var(--color-text-secondary)]">
                    {formatBytes(p.read_bytes)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{p.user}</td>
                  <td
                    className="max-w-xs truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]"
                    onClick={() => navigate(`/query/${p.query_id}`)}
                  >
                    <div className="flex items-center gap-1">
                      <Database className="h-3 w-3 shrink-0" />
                      <span className="truncate">{p.query}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleKill(p.query_id); }}
                      disabled={killing.has(p.query_id)}
                      className="flex items-center gap-1 rounded border border-red-800 bg-red-900/20 px-2 py-1 text-xs text-red-400 hover:bg-red-900/40 disabled:opacity-50"
                      title="Kill query"
                    >
                      {killing.has(p.query_id) ? (
                        <Pause className="h-3 w-3 animate-pulse" />
                      ) : (
                        <Skull className="h-3 w-3" />
                      )}
                      Kill
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
