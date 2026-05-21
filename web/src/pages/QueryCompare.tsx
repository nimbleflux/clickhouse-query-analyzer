import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GitCompare } from "lucide-react";
import { fetchComparison } from "../api/client";
import type { QueryLogEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor, categorizeEvent } from "../utils";

export function QueryCompare() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlA = searchParams.get("a") || "";
  const urlB = searchParams.get("b") || "";
  const [idA, setIdA] = useState(urlA);
  const [idB, setIdB] = useState(urlB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queryA, setQueryA] = useState<QueryLogEntry | null>(null);
  const [queryB, setQueryB] = useState<QueryLogEntry | null>(null);

  const handleCompare = async (a: string, b: string) => {
    if (!a || !b) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchComparison(a, b);
      setQueryA(data.a);
      setQueryB(data.b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comparison");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (urlA && urlB) {
      setIdA(urlA);
      setIdB(urlB);
      handleCompare(urlA, urlB);
    }
  }, [urlA, urlB]);

  const metrics: { label: string; key: keyof QueryLogEntry; format: (v: number) => string; color?: (v: number) => string }[] = [
    { label: "Duration", key: "query_duration_ms", format: formatDuration, color: durationColor },
    { label: "Memory", key: "memory_usage", format: formatBytes, color: memoryColor },
    { label: "Rows Read", key: "read_rows", format: formatNumber },
    { label: "Bytes Read", key: "read_bytes", format: formatBytes },
    { label: "Result Rows", key: "result_rows", format: formatNumber },
    { label: "Written Rows", key: "written_rows", format: formatNumber },
    { label: "Written Bytes", key: "written_bytes", format: formatBytes },
    { label: "Peak Threads", key: "peak_threads_usage", format: (v) => String(v) },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold">Compare Queries</h1>

      <div className="mb-6 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Query ID A</label>
          <input
            type="text"
            value={idA}
            onChange={(e) => setIdA(e.target.value)}
            placeholder="e.g. abc123-def456..."
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <GitCompare className="mb-2 h-5 w-5 text-[var(--color-text-secondary)]" />
        <div className="flex-1">
          <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Query ID B</label>
          <input
            type="text"
            value={idB}
            onChange={(e) => setIdB(e.target.value)}
            placeholder="e.g. 789ghi-012jkl..."
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={() => handleCompare(idA, idB)}
          disabled={loading || !idA || !idB}
          className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {loading ? "Loading..." : "Compare"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--color-error)] bg-red-900/20 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {queryA && queryB && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--color-accent)]">Query A</h3>
            <p className="mb-2 text-xs text-[var(--color-text-secondary)]">{formatTime(queryA.query_start_time)}</p>
            <pre
              className="mb-2 max-h-24 cursor-pointer overflow-auto font-mono text-xs text-[var(--color-text-primary)]"
              onClick={() => navigate(`/query/${queryA.query_id}`)}
            >
              {queryA.query.slice(0, 200)}
            </pre>
            <p className="text-xs text-[var(--color-text-secondary)]">{queryA.user}</p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">Metric</h3>
            {metrics.map((m) => {
              const vA = Number(queryA[m.key]) || 0;
              const vB = Number(queryB[m.key]) || 0;
              const diff = vB - vA;
              const pct = vA > 0 ? ((diff / vA) * 100).toFixed(1) : "-";
              const diffColor = diff > 0 ? "text-[var(--color-error)]" : diff < 0 ? "text-[var(--color-success)]" : "";
              return (
                <div key={String(m.key)} className="mb-2">
                  <div className="text-xs text-[var(--color-text-secondary)]">{m.label}</div>
                  <div className={`text-sm font-mono ${diffColor}`}>
                    {diff > 0 ? "+" : ""}{m.format(Math.abs(diff))}
                    {pct !== "-" && <span className="ml-1 text-xs">({diff > 0 ? "+" : ""}{pct}%)</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--color-accent)]">Query B</h3>
            <p className="mb-2 text-xs text-[var(--color-text-secondary)]">{formatTime(queryB.query_start_time)}</p>
            <pre
              className="mb-2 max-h-24 cursor-pointer overflow-auto font-mono text-xs text-[var(--color-text-primary)]"
              onClick={() => navigate(`/query/${queryB.query_id}`)}
            >
              {queryB.query.slice(0, 200)}
            </pre>
            <p className="text-xs text-[var(--color-text-secondary)]">{queryB.user}</p>
          </div>

          <div className="col-span-3 overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Query A</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Query B</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Diff</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const vA = Number(queryA[m.key]) || 0;
                  const vB = Number(queryB[m.key]) || 0;
                  const diff = vB - vA;
                  const diffColor = diff > 0 ? "text-[var(--color-error)]" : diff < 0 ? "text-[var(--color-success)]" : "";
                  return (
                    <tr key={String(m.key)} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2 text-xs">{m.label}</td>
                      <td className={`px-4 py-2 text-right font-mono text-xs ${m.color ? m.color(vA) : ""}`}>
                        {m.format(vA)}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-xs ${m.color ? m.color(vB) : ""}`}>
                        {m.format(vB)}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-xs ${diffColor}`}>
                        {diff > 0 ? "+" : ""}{m.format(Math.abs(diff))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="col-span-3 overflow-hidden rounded-lg border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2">
              <h3 className="text-sm font-medium text-[var(--color-text-secondary)]">Top Profile Events</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Event</th>
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Category</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Query A</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Query B</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Diff</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const allKeys = new Set<string>();
                  const topA = Object.entries(queryA.profile_events || {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 20);
                  const topB = Object.entries(queryB.profile_events || {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 20);
                  topA.forEach(([k]) => allKeys.add(k));
                  topB.forEach(([k]) => allKeys.add(k));
                  const mapA = Object.fromEntries(topA);
                  const mapB = Object.fromEntries(topB);
                  const merged = Array.from(allKeys).map(k => ({ name: k, a: mapA[k] || 0, b: mapB[k] || 0 }));
                  merged.sort((x, y) => (y.a + y.b) - (x.a + x.b));
                  return merged.slice(0, 30).map(({ name, a: vA, b: vB }) => {
                    const diff = vB - vA;
                    const diffColor = diff > 0 ? "text-[var(--color-error)]" : diff < 0 ? "text-[var(--color-success)]" : "";
                    return (
                      <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="px-4 py-2 font-mono text-xs">{name}</td>
                        <td className="px-4 py-2 text-xs text-[var(--color-text-secondary)]">{categorizeEvent(name)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(vA)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(vB)}</td>
                        <td className={`px-4 py-2 text-right font-mono text-xs ${diffColor}`}>
                          {diff > 0 ? "+" : ""}{formatNumber(Math.abs(diff))}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
