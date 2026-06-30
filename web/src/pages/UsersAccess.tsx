import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Users, KeyRound, ShieldAlert, Trash2, BadgeCheck, AlertTriangle, Search } from "lucide-react";
import { fetchAccess, dropUser, dropRole, revokeGrant } from "../api/client";
import type { AccessOverview, UserRow, RoleRow, GrantRow, QuotaUsageRow, QuotaDef } from "../api/types";
import { ApiError } from "../api/errors";
import { useToast } from "../components/Toast";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { TableSkeleton } from "../components/Skeleton";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/Pagination";
import { formatBytes, formatNumber } from "../utils";

type Tab = "users" | "grants" | "quota";
type DropTarget = { kind: "user" | "role"; name: string };

export function UsersAccess({ connected }: { connected: boolean }) {
  const [data, setData] = useState<AccessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [tab, setTabRaw] = useState<Tab>("users");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [query, setQuery] = useState("");
  const setTab = (t: Tab) => { setTabRaw(t); setPage(1); setQuery(""); };
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
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
      setData(await fetchAccess(controller.signal));
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

  const canManage = !!data?.can_manage_access;

  const handleDrop = async () => {
    if (!dropTarget) return;
    try {
      if (dropTarget.kind === "user") await dropUser(dropTarget.name);
      else await dropRole(dropTarget.name);
      toast(`${dropTarget.kind === "user" ? "User" : "Role"} '${dropTarget.name}' dropped`, "success");
      setTimeout(load, 800);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to drop", "error");
    } finally {
      setDropTarget(null);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    const g = revokeTarget;
    const grantee = g.user_name || g.role_name;
    const kind = g.user_name ? "user" : "role";
    try {
      await revokeGrant(kind, grantee, g.access_type, g.database, g.table, g.column, g.grant_option === 1);
      toast(`Revoked ${g.access_type} from ${grantee}`, "success");
      setTimeout(load, 800);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to revoke", "error");
    } finally {
      setRevokeTarget(null);
    }
  };

  if (!connected) return <NotConnectedState />;
  if (error && !data) return <PageContainer><ErrorState error={error} onRetry={load} /></PageContainer>;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "users", label: "Users & Roles", count: (data?.users.length ?? 0) + (data?.roles.length ?? 0) },
    { id: "grants", label: "Grants", count: data?.grants.length ?? 0 },
    { id: "quota", label: "Quota Usage", count: data?.quota_usage.length ?? 0 },
  ];

  return (
    <PageContainer>
      <PageHeader
        heading="h2"
        title="Users & Access"
        description={data?.current_user ? `Signed in as ${data.current_user}` : "Access management"}
        actions={
          <>
            {loading && data && <RefreshIndicator elapsed={elapsed} />}
            <Button variant="secondary" size="md" onClick={load} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {data && !canManage && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--surface-elevated)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>Read-only — your user lacks access-management privileges. Manage actions are hidden.</span>
        </div>
      )}

      {data?.partial_errors && data.partial_errors.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--state-warning)] px-4 py-2 text-xs text-[var(--color-text-secondary)]"
          title={data.partial_errors.map((t) => `${t}: ${data.partial_error_details?.[t] ?? ""}`).join("\n")}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
          <span>Some sections are unavailable ({data.partial_errors.join(", ")}). Hover for details.</span>
        </div>
      )}

      {error && data && <div className="mb-4"><ErrorState error={error} onRetry={load} /></div>}

      {loading && !data ? (
        <div className="py-4">
          <TableSkeleton rows={6} cols={5} />
          <LoadingNotice elapsed={elapsed} onCancel={cancel} />
        </div>
      ) : canceled && !data ? (
        <LoadingNotice canceled onRetry={load} />
      ) : data ? (
        <>
          <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {t.label} <span className="opacity-60">({t.count})</span>
              </button>
            ))}
          </div>

          {(() => {
            // Paginate the active tab client-side, after a case-insensitive
            // search across the fields relevant to that tab.
            const q = query.trim().toLowerCase();
            const usersF = q ? data.users.filter((u) => u.name.toLowerCase().includes(q) || (u.auth_type ?? []).some((a) => a.toLowerCase().includes(q)) || (u.default_roles ?? []).some((r) => r.toLowerCase().includes(q))) : data.users;
            const grantsF = q ? data.grants.filter((g) => (g.user_name || g.role_name || "").toLowerCase().includes(q) || g.access_type.toLowerCase().includes(q) || `${g.database}.${g.table}`.toLowerCase().includes(q)) : data.grants;
            const quotaF = q ? data.quota_usage.filter((k) => (k.quota_name || "").toLowerCase().includes(q) || (k.quota_key || "").toLowerCase().includes(q)) : data.quota_usage;
            const list = tab === "users" ? usersF : tab === "grants" ? grantsF : quotaF;
            const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * pageSize;
            return (
            <>
              {tab === "users" && <UsersRolesTab users={usersF.slice(start, start + pageSize)} roles={data.roles} canManage={canManage} onDrop={setDropTarget} />}
              {tab === "grants" && <GrantsTab grants={grantsF.slice(start, start + pageSize)} canManage={canManage} onRevoke={setRevokeTarget} />}
              {tab === "quota" && <QuotaTab rows={quotaF.slice(start, start + pageSize)} definitions={data.quotas} />}
              {(list.length > pageSize || q) && (
                <div className="flex flex-wrap items-center gap-2 py-2">
                  <div className="relative min-w-[180px] flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                    <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder={`Search ${tab}…`} className="h-7 pl-8 text-xs" />
                  </div>
                  {list.length > pageSize && (
                    <Pagination page={safePage} pageSize={pageSize} total={list.length} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
                  )}
                </div>
              )}
            </>
            );
          })()}

          <ConfirmDialog
            open={!!dropTarget}
            title={dropTarget?.kind === "user" ? "Drop user" : "Drop role"}
            message={dropTarget ? <p>Drop {dropTarget.kind} <span className="font-mono">{dropTarget.name}</span>? This cannot be undone.</p> : undefined}
            confirmLabel="Drop"
            confirmVariant="danger"
            onConfirm={handleDrop}
            onCancel={() => setDropTarget(null)}
          />
          <ConfirmDialog
            open={!!revokeTarget}
            title="Revoke grant"
            message={revokeTarget ? (
              <p>Revoke <span className="font-mono">{revokeTarget.access_type}</span> on{" "}
                <span className="font-mono">{revokeTarget.database || "*"}{revokeTarget.table ? `.${revokeTarget.table}` : ".*"}</span>{" "}
                from <span className="font-mono">{revokeTarget.user_name || revokeTarget.role_name}</span>?</p>
            ) : undefined}
            confirmLabel="Revoke"
            confirmVariant="danger"
            onConfirm={handleRevoke}
            onCancel={() => setRevokeTarget(null)}
          />
        </>
      ) : null}
    </PageContainer>
  );
}

function UsersRolesTab({ users, roles, canManage, onDrop }: { users: UserRow[]; roles: RoleRow[]; canManage: boolean; onDrop: (t: DropTarget) => void }) {
  if (users.length === 0 && roles.length === 0) {
    return <EmptyState icon={Users} title="No users or roles visible" description="Your user may lack SELECT on system.users / system.roles." />;
  }
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">User</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Auth</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Default roles</th>
            <th className="px-4 py-2.5" />
          </tr></thead>
          <tbody>
            {users.map((u: UserRow) => (
              <tr key={u.name} className="border-b border-[var(--color-border)] last:border-0">
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                    <Users className="h-3 w-3 text-[var(--color-text-secondary)]" /> {u.name}
                    {u.default_database && <span className="opacity-60">db: {u.default_database}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{(u.auth_type ?? []).join(", ") || "-"}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{(u.default_roles ?? []).join(", ") || "-"}</td>
                <td className="px-2 py-3 text-right">
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => onDrop({ kind: "user", name: u.name })} className="text-[var(--color-error)] hover:bg-[var(--state-error)]" title="Drop user">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {roles.map((r: RoleRow) => (
              <tr key={`role-${r.name}`} className="border-b border-[var(--color-border)] last:border-0">
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                    <KeyRound className="h-3 w-3 text-[var(--color-text-secondary)]" /> {r.name}
                    <Badge variant="default">role</Badge>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">{r.storage}</td>
                <td className="px-4 py-3" />
                <td className="px-2 py-3 text-right">
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => onDrop({ kind: "role", name: r.name })} className="text-[var(--color-error)] hover:bg-[var(--state-error)]" title="Drop role">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function GrantsTab({ grants, canManage, onRevoke }: { grants: GrantRow[]; canManage: boolean; onRevoke: (g: GrantRow) => void }) {
  if (grants.length === 0) return <EmptyState icon={KeyRound} title="No grants visible" description="Your user may lack SELECT on system.grants." />;
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Grantee</th>
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Access</th>
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Object</th>
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Flags</th>
          <th className="px-4 py-2.5" />
        </tr></thead>
        <tbody>
          {grants.map((g, i) => (
            <tr key={`${g.user_name || g.role_name}-${g.access_type}-${g.database}-${g.table}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                <div className="flex items-center gap-1.5">
                  {g.user_name ? <Users className="h-3 w-3 text-[var(--color-text-secondary)]" /> : <KeyRound className="h-3 w-3 text-[var(--color-text-secondary)]" />}
                  {g.user_name || g.role_name}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-primary)]">{g.access_type}</td>
              <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                {g.database || "*"}{g.table ? `.${g.table}` : ".*"}{g.column ? ` (${g.column})` : ""}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {g.grant_option === 1 && <Badge variant="secondary"><BadgeCheck className="mr-0.5 h-3 w-3" />grant</Badge>}
                  {g.is_partial_revoke === 1 && <Badge variant="warning">revoke</Badge>}
                </div>
              </td>
              <td className="px-2 py-3 text-right">
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => onRevoke(g)} className="text-[var(--color-error)] hover:bg-[var(--state-error)]" title="Revoke grant">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function QuotaTab({ rows, definitions }: { rows: QuotaUsageRow[]; definitions: QuotaDef[] }) {
  if (rows.length === 0 && definitions.length === 0) return <EmptyState icon={KeyRound} title="No quota usage" description="No quotas configured or visible." />;
  return (
    <div className="space-y-3">
      {definitions.length > 0 && (
        <Card className="p-3">
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Defined quotas ({definitions.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {definitions.map((d) => (
              <span key={d.name} className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--surface-base)] px-2 py-1 text-xs" title={`keys: ${d.keys || "—"}\ndurations: ${(d.durations || []).join(", ")}s\napply to: ${d.apply_to_all ? "all" : (d.apply_to_list || []).join(",") || "—"}${(d.apply_to_except || []).length ? " except " + (d.apply_to_except || []).join(",") : ""}`}>
                <KeyRound className="h-3 w-3 text-[var(--color-text-secondary)]" />
                <span className="font-mono text-[var(--color-text-primary)]">{d.name}</span>
                <span className="text-[var(--color-text-secondary)]">· {(d.durations || []).map((x) => `${x}s`).join("/")}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={KeyRound} title="No quota usage recorded" />
      ) : (
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Quota</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Key</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Window</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Queries</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Errors</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Read</th>
            <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Result</th>
          </tr></thead>
          <tbody>
            {rows.map((q, i) => (
              <tr key={`${q.quota_name}-${q.quota_key}-${q.start_time}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-primary)]">{q.quota_name || "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{q.quota_key}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{q.start_time} → {q.end_time}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]"><UsageBar used={q.queries} max={q.max_queries} /></td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(q.errors)}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(q.read_rows)} / {formatBytes(q.read_bytes)}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(q.result_rows)} / {formatBytes(q.result_bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}

function UsageBar({ used, max }: { used: number; max: number }) {
  if (!max) return <>{formatNumber(used)}</>;
  const pct = Math.min(100, Math.round((used / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-hover)]">
        <div className={`h-full rounded-full ${pct > 90 ? "bg-[var(--color-error)]" : pct > 70 ? "bg-[var(--color-warning)]" : "bg-[var(--color-accent)]"}`} style={{ width: `${pct}%` }} />
      </div>
      <span>{formatNumber(used)} / {formatNumber(max)}</span>
    </div>
  );
}
