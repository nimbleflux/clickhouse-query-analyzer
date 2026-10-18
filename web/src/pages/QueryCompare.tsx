import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GitCompare, ArrowLeftRight, Code, ListTree } from "lucide-react";
import { fetchComparison, fetchExplain } from "../api/client";
import type { QueryLogEntry, ExplainResult } from "../api/types";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor, categorizeEvent } from "../utils";
import { sendToEditor } from "@/lib/send-to-editor";
import { ApiError } from "@/api/errors";
import { diffPlans, type DiffRowKind } from "@/lib/planDiff";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ErrorState, EmptyState, NotConnectedState } from "@/components/ui/state";

interface ComparisonMetric {
  label: string;
  key: keyof QueryLogEntry;
  format: (v: number) => string;
  color?: (v: number) => string;
  // Whether a larger value means a worse query. Output-size metrics (result
  // rows, written rows/bytes) aren't regressions when they grow, so a
  // positive diff must render green there, not red.
  higherIsWorse: boolean;
}

const METRICS: ComparisonMetric[] = [
  { label: "Duration", key: "query_duration_ms", format: formatDuration, color: durationColor, higherIsWorse: true },
  { label: "Memory", key: "memory_usage", format: formatBytes, color: memoryColor, higherIsWorse: true },
  { label: "Rows Read", key: "read_rows", format: formatNumber, higherIsWorse: true },
  { label: "Bytes Read", key: "read_bytes", format: formatBytes, higherIsWorse: true },
  { label: "Result Rows", key: "result_rows", format: formatNumber, higherIsWorse: false },
  { label: "Written Rows", key: "written_rows", format: formatNumber, higherIsWorse: false },
  { label: "Written Bytes", key: "written_bytes", format: formatBytes, higherIsWorse: false },
  { label: "Peak Threads", key: "peak_threads_usage", format: (v) => String(v), higherIsWorse: true },
];

// diffColorClass maps a B−A diff to a semantic color: red when the change is
// a regression for that metric, green when it's an improvement. For metrics
// where more isn't worse (higherIsWorse=false) the polarity flips.
export function diffColorClass(diff: number, higherIsWorse: boolean): string {
  if (diff === 0) return "";
  const isWorse = higherIsWorse ? diff > 0 : diff < 0;
  return isWorse ? "text-[var(--color-error)]" : "text-[var(--color-success)]";
}

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
        <Tabs defaultValue="metrics">
          <TabsList>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="explain" icon={<ListTree />}>EXPLAIN Diff</TabsTrigger>
          </TabsList>
          <TabsContent value="metrics">
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
                      const diffColor = diffColorClass(diff, m.higherIsWorse);
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
          </TabsContent>
          <TabsContent value="explain">
            <ExplainDiffTab idA={queryA.query_id} idB={queryB.query_id} />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}

// Successful EXPLAIN fetches are cached per query id so flipping between the
// Metrics and EXPLAIN Diff tabs doesn't re-run EXPLAIN every time.
const explainCache = new Map<string, ExplainResult>();

interface PlanSideState {
  loading: boolean;
  error?: string;
  plan?: string;
}

/**
 * One side's EXPLAIN plan: fetched on first activation of the diff tab
 * (Radix unmounts inactive tabs, so mount == first activation), with loading
 * and failure surfaced per side so one broken query doesn't hide the other.
 */
function ExplainDiffTab({ idA, idB }: { idA: string; idB: string }) {
  const [sideA, setSideA] = useState<PlanSideState>({ loading: true });
  const [sideB, setSideB] = useState<PlanSideState>({ loading: true });

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async (id: string, set: (s: PlanSideState) => void) => {
      const cached = explainCache.get(id);
      if (cached) {
        set({ loading: false, plan: cached.plan ?? "" });
        return;
      }
      try {
        const res = await fetchExplain(id, false, ctrl.signal);
        explainCache.set(id, res);
        set({ loading: false, plan: res.plan ?? "" });
      } catch (e) {
        if (e instanceof ApiError && e.isAbort()) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        set({ loading: false, error: e instanceof Error ? e.message : "Failed to load plan" });
      }
    };
    setSideA({ loading: true });
    setSideB({ loading: true });
    void load(idA, setSideA);
    void load(idB, setSideB);
    return () => ctrl.abort();
  }, [idA, idB]);

  const rows = !sideA.loading && !sideB.loading && !sideA.error && !sideB.error
    ? diffPlans(sideA.plan ?? "", sideB.plan ?? "")
    : [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PlanSideCard label="Query A" state={sideA} />
        <PlanSideCard label="Query B" state={sideB} />
      </div>

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--surface-elevated)] px-4 py-2">
            <span className="text-sm font-medium text-[var(--color-text-secondary)]">Plan diff (A → B)</span>
            <DiffLegend />
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <pre className="min-w-max font-mono text-xs leading-5">
              {rows.map((r, i) => (
                <div key={i} className={diffRowClass(r.kind)}>
                  <span className="inline-block w-6 select-none pr-2 text-right opacity-40">{i + 1}</span>
                  {r.text || " "}
                </div>
              ))}
            </pre>
          </div>
        </Card>
      )}

      {rows.length === 0 && !sideA.loading && !sideB.loading && !sideA.error && !sideB.error && (
        <EmptyState
          icon={ListTree}
          title="No plan differences"
          description="Both queries produced the same EXPLAIN plan."
        />
      )}
    </div>
  );
}

function PlanSideCard({ label, state }: { label: string; state: PlanSideState }) {
  const lines = state.plan ? state.plan.split("\n").filter((l) => l.trim() !== "").length : 0;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--color-accent)]">{label} plan</h3>
        {!state.loading && !state.error && (
          <span className="text-xs text-[var(--color-text-secondary)]">{lines} lines</span>
        )}
      </div>
      {state.loading ? (
        <p className="text-xs text-[var(--color-text-secondary)]">Running EXPLAIN…</p>
      ) : state.error ? (
        <p className="font-mono text-xs text-[var(--color-error)]">{state.error}</p>
      ) : (
        <pre className="max-h-32 overflow-auto font-mono text-xs text-[var(--color-text-secondary)]">
          {(state.plan || "").slice(0, 500)}
          {(state.plan || "").length > 500 ? "…" : ""}
        </pre>
      )}
    </Card>
  );
}

const LEGEND_ITEMS: { kind: DiffRowKind; label: string }[] = [
  { kind: "same", label: "Same" },
  { kind: "added", label: "Added (B)" },
  { kind: "removed", label: "Removed (A)" },
  { kind: "changed", label: "Changed" },
];

function DiffLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {LEGEND_ITEMS.map(({ kind, label }) => (
        <span key={kind} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${diffRowClass(kind)}`}>
          <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Kind-based color: token state backgrounds tint the line, text matches. */
function diffRowClass(kind: DiffRowKind): string {
  switch (kind) {
    case "added":
      return "bg-[var(--state-success)] text-[var(--color-success)]";
    case "removed":
      return "bg-[var(--state-error)] text-[var(--color-error)] line-through";
    case "changed":
      return "bg-[var(--state-warning)] text-[var(--color-warning)]";
    default:
      return "text-[var(--color-text-primary)]";
  }
}

function QuerySideCard({ label, query, onNavigate, onSendToEditor }: { label: string; query: QueryLogEntry; onNavigate: (path: string) => void; onSendToEditor: (sql: string) => void }) {  return (
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
          const diffColor = diffColorClass(diff, m.higherIsWorse);
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
            // Profile events all measure work done, so more is always worse.
            const diffColor = diffColorClass(diff, true);
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
