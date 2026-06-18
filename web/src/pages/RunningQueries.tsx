import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Skull, MemoryStick, Database, RefreshCw, Pause, Copy, Search, Filter, Send } from "lucide-react";
import { fetchProcesses, killProcess } from "../api/client";
import type { ProcessEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, durationColor, memoryColor } from "../utils";
import { TableSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select, Checkbox } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, NotConnectedState } from "@/components/ui/state";
import { sendToEditor } from "@/lib/send-to-editor";
import { ApiError } from "@/api/errors";

const QUERY_KINDS = ["Select", "Insert", "Create", "Alter", "Drop", "Explain", "System", "Other"] as const;
const INTERNAL_PREFIXES = ["SYSTEM", "KILL", "SET", "SHOW", "EXISTS", "USE"];

function queryKind(query: string): string {
  const upper = query.trim().toUpperCase();
  for (const kind of QUERY_KINDS) {
    if (upper.startsWith(kind.toUpperCase())) return kind;
  }
  return "Other";
}

export function RunningQueries({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const copy = useCopyToClipboard();
  const [processes, setProcesses] = useState<ProcessEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [killing, setKilling] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [killTarget, setKillTarget] = useState<ProcessEntry | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterUser, setFilterUser] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    try {
      const result = await fetchProcesses(controller.signal);
      setProcesses(result);
    } catch (e) {
      if (e instanceof ApiError && e.isAbort()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Failed to load processes"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    load();
  }, [load, connected]);

  useEffect(() => {
    if (!connected || !autoRefresh) return;
    intervalRef.current = setInterval(load, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load, connected]);

  const handleKill = async (queryId: string) => {
    setKilling((prev) => new Set(prev).add(queryId));
    try {
      await killProcess(queryId);
      toast("Query killed", "success");
      setTimeout(load, 500);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to kill query", "error");
    } finally {
      setKilling((prev) => {
        const next = new Set(prev);
        next.delete(queryId);
        return next;
      });
    }
    setKillTarget(null);
  };

  const filtered = useMemo(() => {
    return processes.filter((p) => {
      const q = p.query.toLowerCase();
      const id = p.query_id.toLowerCase();
      if (debouncedSearch && !q.includes(debouncedSearch.toLowerCase()) && !id.includes(debouncedSearch.toLowerCase())) return false;
      if (filterUser && p.user.toLowerCase() !== filterUser.toLowerCase()) return false;
      if (filterKind) {
        const kind = queryKind(p.query);
        if (filterKind === "Other" && QUERY_KINDS.slice(0, -1).includes(kind as typeof QUERY_KINDS[number])) return false;
        if (filterKind !== "Other" && kind !== filterKind) return false;
      }
      if (!showSystem) {
        const upper = p.query.trim().toUpperCase();
        if (INTERNAL_PREFIXES.some((p) => upper.startsWith(p))) return false;
        if (p.query.includes("system.") || p.query.includes("INFORMATION_SCHEMA")) return false;
      }
      return true;
    });
  }, [processes, debouncedSearch, filterUser, filterKind, showSystem]);

  const users = useMemo(() => [...new Set(processes.map((p) => p.user))].sort(), [processes]);

  if (!connected) return <NotConnectedState />;

  return (
    <PageContainer>
      <ConfirmDialog
        open={!!killTarget}
        title="Kill Query"
        message={
          killTarget ? (
            <div className="space-y-2">
              <p>Are you sure you want to kill this query?</p>
              <div className="rounded bg-[var(--surface-base)] p-2">
                <p className="font-mono text-xs break-all">{killTarget.query.slice(0, 200)}{killTarget.query.length > 200 ? "..." : ""}</p>
              </div>
              <div className="flex gap-4 text-xs text-[var(--color-text-secondary)]">
                <span>Duration: {formatDuration(killTarget.query_duration_ms)}</span>
                <span>Memory: {formatBytes(killTarget.memory_usage)}</span>
                <span>User: {killTarget.user}</span>
              </div>
            </div>
          ) : undefined
        }
        confirmLabel="Kill Query"
        confirmVariant="danger"
        onConfirm={() => killTarget && handleKill(killTarget.query_id)}
        onCancel={() => setKillTarget(null)}
      />

      <PageHeader
        heading="h2"
        title="Running Queries"
        description="Live view of system.processes"
        actions={
          <>
            <Button
              variant={autoRefresh ? "primary" : "secondary"}
              size="md"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: "3s" } : undefined} />
              Live
            </Button>
            <Button variant="secondary" size="md" onClick={load} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            data-search-input
            type="text"
            placeholder="Search running queries… (Ctrl+K)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] outline-none transition-colors focus:border-[var(--color-accent)]"
          />
        </div>
        <Button variant={showFilters ? "primary" : "secondary"} size="md" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-3.5 w-3.5" />
          Filters
        </Button>
        <Checkbox
          checked={showSystem}
          onChange={(e) => setShowSystem(e.target.checked)}
          label="Internal queries"
        />
        {filtered.length > 0 && (
          <Badge variant="default">{filtered.length} running</Badge>
        )}
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">User</label>
              <Select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="w-full">
                <option value="">All users</option>
                {users.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-[var(--color-text-secondary)]">Query Kind</label>
              <Select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className="w-full">
                <option value="">All</option>
                {QUERY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </Select>
            </div>
          </div>
        </Card>
      )}

      {error && <ErrorState error={error} onRetry={load} />}

      {loading && processes.length === 0 ? (
        <div className="py-4"><TableSkeleton rows={5} cols={7} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={processes.length === 0 ? "No running queries" : "No queries match filters"}
          description={processes.length === 0 ? "All quiet on the ClickHouse front." : "Try removing filters or expanding the search."}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Duration</th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Memory</th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Peak</th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Rows</th>
                  <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]">Data</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">User</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]">Query</th>
                  <th className="px-4 py-2.5" />
                  <th className="px-4 py-2.5" />
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.query_id}
                    onClick={() => navigate(`/query/${p.query_id}`)}
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors"
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
                      className="max-w-md truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]"
                      title={p.query}
                    >
                      <div className="flex items-center gap-1">
                        <Database className="h-3 w-3 shrink-0" />
                        <span className="truncate">{p.query}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => { e.stopPropagation(); sendToEditor(navigate, p.query); }}
                        title="Open in SQL Editor"
                      >
                        <Send className="h-3 w-3" />
                      </Button>
                    </td>
                    <td className="px-2 py-3">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => { e.stopPropagation(); copy(p.query_id, "Query ID copied!"); }}
                        title="Copy query ID"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </td>
                    <td className="px-2 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); setKillTarget(p); }}
                        disabled={killing.has(p.query_id)}
                        className="text-[var(--color-error)] hover:bg-[var(--state-error)]"
                        title="Kill query"
                      >
                        {killing.has(p.query_id) ? (
                          <Pause className="h-3 w-3 animate-pulse" />
                        ) : (
                          <Skull className="h-3 w-3" />
                        )}
                        Kill
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
