import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FlaskConical, RefreshCw, Search, AlertTriangle, Clock, Skull } from "lucide-react";
import { fetchMutations, killMutation } from "../api/client";
import type { MutationDetail } from "../api/types";
import { ApiError } from "../api/errors";
import { useToast } from "../components/Toast";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Checkbox } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { ConfirmDialog } from "@/components/ui/dialog";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";
import { TableName } from "@/components/TableName";
import { formatDuration, formatNumber } from "../utils";

function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" | "error" }) {
  const toneClass = tone === "error" ? "text-[var(--color-error)]" : tone === "warning" ? "text-[var(--color-warning)]" : "text-[var(--color-text-primary)]";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        <Clock className="h-3 w-3" /> {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}

export function Mutations({ connected }: { connected: boolean }) {
  const [mutations, setMutations] = useState<MutationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [killing, setKilling] = useState<Set<string>>(new Set());
  const [killTarget, setKillTarget] = useState<MutationDetail | null>(null);
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [minAge, setMinAge] = useState(0); // seconds; 0 = all
  const controllerRef = useRef<AbortController | null>(null);
  const elapsed = useElapsedTimer(loading);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setCanceled(false);
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await fetchMutations(controller.signal);
      setMutations(result);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e : ApiError.wrap(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    load();
  }, [load, connected]);

  const cancel = useCallback(() => {
    setCanceled(true);
    controllerRef.current?.abort();
    setLoading(false);
  }, []);

  const handleKill = async (m: MutationDetail) => {
    const key = `${m.database}.${m.table}.${m.mutation_id}`;
    setKilling((prev) => new Set(prev).add(key));
    try {
      await killMutation(m.database, m.table, m.mutation_id);
      toast("Mutation kill issued — it finishes in-progress parts, then clears", "success");
      setTimeout(load, 1500);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      toast(e instanceof Error ? e.message : "Failed to kill mutation", "error");
    } finally {
      setKilling((prev) => { const n = new Set(prev); n.delete(key); return n; });
      setKillTarget(null);
    }
  };

  const filtered = useMemo(() => {
    let out = mutations;
    if (minAge > 0) out = out.filter((m) => m.age_seconds >= minAge);
    if (errorsOnly) out = out.filter((m) => m.latest_fail_reason);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((m) => `${m.database}.${m.table}`.toLowerCase().includes(q) || m.command.toLowerCase().includes(q));
    }
    return out;
  }, [mutations, minAge, errorsOnly, search]);

  const stats = useMemo(() => {
    let failed = 0, killed = 0, oldest = 0;
    for (const m of mutations) {
      if (m.latest_fail_reason) failed++;
      if (m.is_killed) killed++;
      if (m.age_seconds > oldest) oldest = m.age_seconds;
    }
    return { total: mutations.length, failed, killed, oldest };
  }, [mutations]);

  if (!connected) return <NotConnectedState />;

  if (error && mutations.length === 0) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={load} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Mutations"
        description="Active ALTER … UPDATE/DELETE/TTL mutations (system.mutations)"
        actions={
          <>
            {loading && mutations.length > 0 && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && mutations.length > 0 && <div className="mb-4"><ErrorState error={error} onRetry={load} /></div>}

      {loading && mutations.length === 0 ? (
        <div className="py-4">
          <TableSkeleton rows={5} cols={6} />
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </div>
      ) : canceled && mutations.length === 0 ? (
        <LoadingNotice canceled onRetry={load} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Active" value={formatNumber(stats.total)} tone={stats.total > 0 ? "warning" : "default"} />
            <StatCard label="Failed" value={formatNumber(stats.failed)} tone={stats.failed > 0 ? "error" : "default"} />
            <StatCard label="Killed" value={formatNumber(stats.killed)} />
            <StatCard label="Oldest" value={stats.oldest ? formatDuration(stats.oldest * 1000) : "-"} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by table or command…"
                className="pl-9"
              />
            </div>
            <Checkbox checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} label="Failed only" />
            <TimeframeSelector
              options={[
                { label: "All", value: 0 },
                { label: ">1m", value: 60 },
                { label: ">1h", value: 3600 },
                { label: ">6h", value: 21600 },
                { label: ">24h", value: 86400 },
              ]}
              value={minAge}
              onChange={setMinAge}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title={mutations.length === 0 ? "No active mutations" : "No mutations match filters"}
              description={mutations.length === 0 ? "Nothing waiting in system.mutations." : "Try clearing the search or the failed-only filter."}
            />
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Table</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Command</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Age</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Parts to do</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Status</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m) => {
                      const key = `${m.database}.${m.table}.${m.mutation_id}`;
                      const isKilling = killing.has(key);
                      return (
                        <tr key={key} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-primary)]">
                            <TableName database={m.database} table={m.table} />
                          </td>
                          <td className="max-w-md truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]" title={m.command}>
                            {m.command}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                            {formatDuration(m.age_seconds * 1000)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                            {formatNumber(m.parts_to_do)}
                          </td>
                          <td className="px-4 py-3">
                            {m.is_killed ? (
                              <Badge variant="warning">Killed</Badge>
                            ) : m.latest_fail_reason ? (
                              <Badge variant="error" title={m.latest_fail_reason}>Failed</Badge>
                            ) : (
                              <Badge variant="success">Running</Badge>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setKillTarget(m)}
                              disabled={isKilling || m.is_killed === 1}
                              className="text-[var(--color-error)] hover:bg-[var(--state-error)]"
                              title={m.is_killed ? "Already killed" : "Kill mutation"}
                            >
                              <Skull className="h-3 w-3" />
                              {isKilling ? "Killing…" : "Kill"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {stats.failed > 0 && (
            <div className="mt-4 space-y-2">
              {filtered.filter((m) => m.latest_fail_reason).slice(0, 5).map((m) => (
                <div key={`fail-${m.database}.${m.table}.${m.mutation_id}`} className="flex items-start gap-2 rounded-md border border-[var(--color-error)]/30 bg-[var(--state-error)] px-3 py-2 text-xs text-[var(--color-error)]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono font-medium">{m.database}.{m.table}</span>
                    {m.latest_fail_error_code_name && <span className="ml-1 opacity-80">[{m.latest_fail_error_code_name}]</span>}
                    <div className="mt-0.5 break-words font-mono opacity-90">{m.latest_fail_reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!killTarget}
        title="Kill mutation"
        message={
          killTarget ? (
            <div className="space-y-2">
              <p>
                Kill mutation on <span className="font-mono">{killTarget.database}.{killTarget.table}</span>?
              </p>
              <p className="text-xs opacity-80">
                Already-in-progress parts finish; the mutation stops being assigned new parts and clears once done.
              </p>
              <p className="text-xs opacity-80">This cannot be undone.</p>
            </div>
          ) : undefined
        }
        confirmLabel="Kill mutation"
        confirmVariant="danger"
        onConfirm={() => killTarget && handleKill(killTarget)}
        onCancel={() => setKillTarget(null)}
      />
    </PageContainer>
  );
}
