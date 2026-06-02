import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Skull, MemoryStick, Database, RefreshCw, Pause, Copy, Search, Filter } from "lucide-react";
import { fetchProcesses, killProcess } from "../api/client";
import type { ProcessEntry } from "../api/types";
import { formatDuration, formatBytes, formatNumber, durationColor, memoryColor } from "../utils";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { TableSkeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

function queryKind(query: string): string {
	const upper = query.trim().toUpperCase();
	if (upper.startsWith("SELECT")) return "Select";
	if (upper.startsWith("INSERT")) return "Insert";
	if (upper.startsWith("CREATE")) return "Create";
	if (upper.startsWith("ALTER")) return "Alter";
	if (upper.startsWith("DROP")) return "Drop";
	if (upper.startsWith("EXPLAIN")) return "Explain";
	if (upper.startsWith("SYSTEM")) return "System";
	return "Other";
}

export function RunningQueries() {
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
      if (e instanceof DOMException && e.name === "AbortError") return;
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
      if (debouncedSearch && !p.query.toLowerCase().includes(debouncedSearch.toLowerCase()) && !p.query_id.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (filterUser && p.user.toLowerCase() !== filterUser.toLowerCase()) return false;
      if (filterKind) {
        const kind = queryKind(p.query);
        if (filterKind === "Other" && ["Select", "Insert", "Create", "Alter", "Drop", "Explain", "System"].includes(kind)) return false;
        if (filterKind !== "Other" && kind !== filterKind) return false;
      }
      if (!showSystem) {
        const upper = p.query.trim().toUpperCase();
        if (upper.startsWith("SYSTEM") || upper.startsWith("KILL") || upper.startsWith("SET") || upper.startsWith("SHOW") || upper.startsWith("EXISTS") || upper.startsWith("USE")) return false;
        if (p.query.includes("system.") || p.query.includes("INFORMATION_SCHEMA")) return false;
      }
      return true;
    });
  }, [processes, debouncedSearch, filterUser, filterKind, showSystem]);

  const users = useMemo(() => [...new Set(processes.map((p) => p.user))].sort(), [processes]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <ConfirmDialog
        open={!!killTarget}
        title="Kill Query"
        message={
          killTarget ? (
            <div className="space-y-2">
              <p>Are you sure you want to kill this query?</p>
              <div className="rounded bg-[var(--color-bg-primary)] p-2">
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

      <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-[var(--color-text-secondary)]" />
          <h2 className="text-lg font-semibold">Running Queries</h2>
          <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-medium text-white">
            {filtered.length}
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

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            type="text"
            placeholder="Search queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2 pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm ${
            showFilters
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
        <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          Internal queries
        </label>
      </div>

      {showFilters && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">User</label>
              <select
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
              >
                <option value="">All users</option>
                {users.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-text-secondary)]">Query Kind</label>
              <select
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value)}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] outline-none"
              >
                <option value="">All</option>
                <option value="Select">SELECT</option>
                <option value="Insert">INSERT</option>
                <option value="Create">CREATE</option>
                <option value="Alter">ALTER</option>
                <option value="Drop">DROP</option>
                <option value="Explain">EXPLAIN</option>
                <option value="System">SYSTEM</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-sm text-[var(--color-error)]">
          {error}
        </div>
      )}

      {loading && processes.length === 0 ? (
        <div className="py-4"><TableSkeleton rows={5} cols={7} /></div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <Activity className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p>{processes.length === 0 ? "No running queries" : "No queries match filters"}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <div className="overflow-x-auto">
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
                  <th className="px-4 py-2.5 font-medium text-[var(--color-text-secondary)]"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
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
                      className="max-w-md truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]"
                      onClick={() => navigate(`/query/${p.query_id}`)}
                      title={p.query}
                    >
                      <div className="flex items-center gap-1">
                        <Database className="h-3 w-3 shrink-0" />
                        <span className="truncate">{p.query}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); copy(p.query_id, "Query ID copied!"); }}
                        className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        title="Copy query ID"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); setKillTarget(p); }}
                        disabled={killing.has(p.query_id)}
                        className="flex items-center gap-1 rounded border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-2 py-1 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/20 disabled:opacity-50"
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
        </div>
      )}
      </div>
    </div>
  );
}
