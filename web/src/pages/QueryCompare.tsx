import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GitCompare, ArrowLeftRight, Code } from "lucide-react";
import { fetchComparison } from "../api/client";
import type { QueryLogEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor, categorizeEvent } from "../utils";
import { sendToEditor } from "@/lib/send-to-editor";
import { ApiError } from "@/api/errors";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ErrorState, EmptyState, NotConnectedState } from "@/components/ui/state";

interface ComparisonMetric {
  label: string;
  key: keyof QueryLogEntry;
  format: (v: number) => string;
  color?: (v: number) => string;
}

const METRICS: ComparisonMetric[] = [
  { label: "Duration", key: "query_duration_ms", format: formatDuration, color: durationColor },
  { label: "Memory", key: "memory_usage", format: formatBytes, color: memoryColor },
  { label: "Rows Read", key: "read_rows", format: formatNumber },
  { label: "Bytes Read", key: "read_bytes", format: formatBytes },
  { label: "Result Rows", key: "result_rows", format: formatNumber },
  { label: "Written Rows", key: "written_rows", format: formatNumber },
  { label: "Written Bytes", key: "written_bytes", format: formatBytes },
  { label: "Peak Threads", key: "peak_threads_usage", format: (v) => String(v) },
];

export function QueryCompare({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlA = searchParams.get("a") || "";
  const urlB = searchParams.get("b") || "";
  const [idA, setIdA] = useState(urlA);
  const [idB, setIdB] = useState(urlB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queryA, setQueryA] = useState<QueryLogEntry | null>(null);
  const [queryB, setQueryB] = useState<QueryLogEntry | null>(null);

  const handleCompare = async (a: string, b: string, signal?: AbortSignal) => {
    if (!a || !b) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchComparison(a, b, signal);
      setQueryA(data.a);
      setQueryB(data.b);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Failed to load comparison"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!connected || !urlA || !urlB) return;
    setIdA(urlA);
    setIdB(urlB);
    const controller = new AbortController();
    handleCompare(urlA, urlB, controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlA, urlB, connected]);

  const swap = () => {
    const next = `${idB}|${idA}`.split("|");
    setIdA(next[0]);
    setIdB(next[1]);
    setSearchParams({ a: next[0], b: next[1] });
  };

  if (!connected) return <NotConnectedState />;

  return (
    <PageContainer>
      <PageHeader
        heading="h1"
        title="Compare Queries"
        description="Side-by-side diff of two query executions."
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Query ID A</label>
            <Input
              value={idA}
              onChange={(e) => setIdA(e.target.value)}
              placeholder="e.g. abc123-def456…"
              className="w-full"
            />
          </div>
          <Button variant="ghost" size="icon" onClick={swap} title="Swap A and B">
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Query ID B</label>
            <Input
              value={idB}
              onChange={(e) => setIdB(e.target.value)}
              placeholder="e.g. 789ghi-012jkl…"
              className="w-full"
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setSearchParams({ a: idA, b: idB });
              handleCompare(idA, idB);
            }}
            disabled={loading || !idA || !idB}
          >
            <GitCompare className="h-3.5 w-3.5" />
            {loading ? "Loading…" : "Compare"}
          </Button>
        </div>
      </Card>

      {error && <ErrorState error={error} onRetry={() => handleCompare(idA, idB)} />}

      {!queryA && !queryB && !loading && !error && (
        <EmptyState
          icon={GitCompare}
          title="Enter two query IDs to compare"
          description="Tip: select two queries on the Queries page and click Compare to navigate here automatically."
        />
      )}

      {queryA && queryB && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <QuerySideCard label="Query A" query={queryA} onNavigate={navigate} onSendToEditor={(sql) => sendToEditor(navigate, sql, { origin: "compare-a" })} />
          <DiffColumn queryA={queryA} queryB={queryB} />
          <QuerySideCard label="Query B" query={queryB} onNavigate={navigate} onSendToEditor={(sql) => sendToEditor(navigate, sql, { origin: "compare-b" })} />

          <Card className="overflow-hidden lg:col-span-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Metric</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Query A</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Query B</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Diff</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
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
          </Card>

          <ProfileEventsCard queryA={queryA} queryB={queryB} />
        </div>
      )}
    </PageContainer>
  );
}

function QuerySideCard({ label, query, onNavigate, onSendToEditor }: { label: string; query: QueryLogEntry; onNavigate: (path: string) => void; onSendToEditor: (sql: string) => void }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-accent)]">{label}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSendToEditor(query.query)}
          title="Open in Editor"
        >
          <Code className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mb-2 text-xs text-[var(--color-text-secondary)]">{formatTime(query.query_start_time)}</p>
      <pre
        className="mb-2 max-h-24 cursor-pointer overflow-auto font-mono text-xs text-[var(--color-text-primary)]"
        onClick={() => onNavigate(`/query/${query.query_id}`)}
        title="Open in Query Detail"
      >
        {query.query.slice(0, 200)}
      </pre>
      <p className="text-xs text-[var(--color-text-secondary)]">{query.user}</p>
    </Card>
  );
}

function DiffColumn({ queryA, queryB }: { queryA: QueryLogEntry; queryB: QueryLogEntry }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">Diff (B − A)</h3>
      <div className="space-y-2">
        {METRICS.map((m) => {
          const vA = Number(queryA[m.key]) || 0;
          const vB = Number(queryB[m.key]) || 0;
          const diff = vB - vA;
          const pct = vA > 0 ? ((diff / vA) * 100).toFixed(1) : null;
          const diffColor = diff > 0 ? "text-[var(--color-error)]" : diff < 0 ? "text-[var(--color-success)]" : "";
          return (
            <div key={String(m.key)}>
              <div className="text-xs text-[var(--color-text-secondary)]">{m.label}</div>
              <div className={`text-sm font-mono ${diffColor}`}>
                {diff > 0 ? "+" : ""}{m.format(Math.abs(diff))}
                {pct && <span className="ml-1 text-xs">({diff > 0 ? "+" : ""}{pct}%)</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ProfileEventsCard({ queryA, queryB }: { queryA: QueryLogEntry; queryB: QueryLogEntry }) {
  const allKeys = new Set<string>();
  const topA = Object.entries(queryA.profile_events || {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 20);
  const topB = Object.entries(queryB.profile_events || {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 20);
  topA.forEach(([k]) => allKeys.add(k));
  topB.forEach(([k]) => allKeys.add(k));
  const mapA = Object.fromEntries(topA);
  const mapB = Object.fromEntries(topB);
  const merged = Array.from(allKeys).map((k) => ({ name: k, a: mapA[k] || 0, b: mapB[k] || 0 }));
  merged.sort((x, y) => y.a + y.b - (x.a + x.b));
  const top = merged.slice(0, 30);

  return (
    <Card className="overflow-hidden lg:col-span-3">
      <div className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)]">
        Top Profile Events
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
          {top.map(({ name, a: vA, b: vB }) => {
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
          })}
        </tbody>
      </table>
    </Card>
  );
}
