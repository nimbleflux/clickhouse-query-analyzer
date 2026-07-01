import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Users, KeyRound, ShieldAlert, Trash2, BadgeCheck, AlertTriangle, Search, ChevronRight, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
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
import { useTableSort, SortableHeader } from "@/components/ui/table-sort";
import { EmptyState, ErrorState, NotConnectedState, RefreshIndicator, LoadingNotice } from "@/components/ui/state";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/Pagination";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";
import { formatBytes, formatNumber } from "../utils";

type Tab = "users" | "roles" | "grants" | "quota";
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
  const [roleFilter, setRoleFilter] = useState<string>("");
  const setTab = (t: Tab) => { setTabRaw(t); setPage(1); setQuery(""); };
  const showRole = (role: string) => { setRoleFilter(role); setTabRaw("roles"); setPage(1); };
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
    { id: "users", label: "Users", count: data?.users.length ?? 0 },
    { id: "roles", label: "Roles", count: data?.roles.length ?? 0 },
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
            // Paginate users/quota client-side; grants are grouped by grantee
            // (collapsible) instead of paginated. A case-insensitive search
            // applies to all tabs.
            const q = query.trim().toLowerCase();
            const usersF = q ? data.users.filter((u) => u.name.toLowerCase().includes(q) || (u.auth_type ?? []).some((a) => a.toLowerCase().includes(q)) || (u.default_roles ?? []).some((r) => r.toLowerCase().includes(q))) : data.users;
            const grantsF = q ? data.grants.filter((g) => (g.user_name || g.role_name || "").toLowerCase().includes(q) || g.access_type.toLowerCase().includes(q) || `${g.database}.${g.table}`.toLowerCase().includes(q)) : data.grants;
            const quotaF = q ? data.quota_usage.filter((k) => (k.quota_name || "").toLowerCase().includes(q) || (k.quota_key || "").toLowerCase().includes(q)) : data.quota_usage;
            const paged = tab === "grants" ? grantsF : tab === "users" ? usersF : quotaF;
            const totalPages = Math.max(1, Math.ceil(paged.length / pageSize));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * pageSize;
            return (
            <>
              <div className="flex flex-wrap items-center gap-2 py-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                  <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder={`Search ${tab}…`} className="h-7 pl-8 text-xs" />
                </div>
                {tab !== "grants" && paged.length > pageSize && (
                  <Pagination page={safePage} pageSize={pageSize} total={paged.length} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
                )}
              </div>
              {tab === "users" && <UsersRolesTab users={usersF.slice(start, start + pageSize)} canManage={canManage} onDrop={setDropTarget} onRoleClick={showRole} />}
              {tab === "roles" && <RolesTab roles={data.roles} users={data.users} grants={data.grants} focusRole={roleFilter} canManage={canManage} onDrop={setDropTarget} />}
              {tab === "grants" && <GrantsTab grants={grantsF} canManage={canManage} onRevoke={setRevokeTarget} onRoleClick={showRole} />}
              {tab === "quota" && <QuotaTab rows={quotaF.slice(start, start + pageSize)} definitions={data.quotas} />}
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

function UsersRolesTab({ users, canManage, onDrop, onRoleClick }: { users: UserRow[]; canManage: boolean; onDrop: (t: DropTarget) => void; onRoleClick: (role: string) => void }) {
  if (users.length === 0) {
    return <EmptyState icon={Users} title="No users visible" description="Your user may lack SELECT on system.users." />;
  }
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">User</th>
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Auth</th>
          <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Roles</th>
          <th className="px-4 py-2.5" />
        </tr></thead>
        <tbody>
          {users.map((u: UserRow) => {
            const rolesList = u.default_roles ?? [];
            return (
              <tr key={u.name} className="border-b border-[var(--color-border)] last:border-0">
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                    <Users className="h-3 w-3 text-[var(--color-text-secondary)]" />{" "}
                    <Link to={`/queries?user=${encodeURIComponent(u.name)}`} className="text-[var(--color-accent)] hover:underline" title={`Show queries run by ${u.name}`}>
                      {u.name}
                    </Link>
                    {u.default_database && <span className="opacity-60">db: {u.default_database}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{(u.auth_type ?? []).join(", ") || "-"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {rolesList.length === 0 && <span className="text-xs text-[var(--color-text-secondary)]">-</span>}
                    {rolesList.map((r) => (
                      <button key={r} onClick={() => onRoleClick(r)} title={`Show role ${r} (members + grants)`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                        <KeyRound className="h-2.5 w-2.5" />{r}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-3 text-right">
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => onDrop({ kind: "user", name: u.name })} className="text-[var(--color-error)] hover:bg-[var(--state-error)]" title="Drop user">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function RolesTab({ roles, users, grants, focusRole, canManage, onDrop }: { roles: RoleRow[]; users: UserRow[]; grants: GrantRow[]; focusRole: string; canManage: boolean; onDrop: (t: DropTarget) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusRole ? [focusRole] : []));
  const toggle = (name: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  if (roles.length === 0) return <EmptyState icon={KeyRound} title="No roles visible" description="Your user may lack SELECT on system.roles." />;
  return (
    <div className="space-y-2">
      {roles.map((r) => {
        const members = users.filter((u) => (u.default_roles ?? []).includes(r.name));
        const roleGrants = grants.filter((g) => g.role_name === r.name);
        const open = expanded.has(r.name);
        return (
          <div key={r.name} className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)]">
            <button onClick={() => toggle(r.name)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-hover)]">
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-90" : ""}`} />
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{r.name}</span>
              <Badge variant="default">{members.length} member{members.length === 1 ? "" : "s"}</Badge>
              <Badge variant="default">{roleGrants.length} grant{roleGrants.length === 1 ? "" : "s"}</Badge>
              <span className="ml-auto">
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDrop({ kind: "role", name: r.name }); }} className="text-[var(--color-error)] hover:bg-[var(--state-error)]" title="Drop role">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </span>
            </button>
            {open && (
              <div className="space-y-3 border-t border-[var(--color-border)] p-3">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Members</div>
                  <div className="flex flex-wrap gap-1">
                    {members.length === 0 ? <span className="text-xs text-[var(--color-text-secondary)]">no members</span> : members.map((m) => (
                      <Link key={m.name} to={`/queries?user=${encodeURIComponent(m.name)}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                        <Users className="h-2.5 w-2.5" />{m.name}
                      </Link>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Grants</div>
                  <div className="space-y-0.5">
                    {roleGrants.length === 0 ? <span className="text-xs text-[var(--color-text-secondary)]">no grants</span> : roleGrants.map((g, i) => (
                      <div key={i} className="font-mono text-xs text-[var(--color-text-secondary)]">
                        <span className="text-[var(--color-text-primary)]">{g.access_type}</span> on {g.database || "*"}{g.table ? `.${g.table}` : ".*"}{g.column ? ` (${g.column})` : ""}
                        {g.grant_option === 1 && <Badge variant="secondary"><BadgeCheck className="mr-0.5 inline h-3 w-3" />grant option</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GrantsTab({ grants, canManage, onRevoke, onRoleClick }: { grants: GrantRow[]; canManage: boolean; onRevoke: (g: GrantRow) => void; onRoleClick: (role: string) => void }) {
  const [groupMode, setGroupMode] = useState<"grantee" | "privilege">("grantee");
  // `expanded` holds open group keys (grantee names or privilege keys).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (grants.length === 0) return <EmptyState icon={KeyRound} title="No grants visible" description="Your user may lack SELECT on system.grants." />;

  // ---- Group by grantee (user/role) ----
  const granteeGroups = new Map<string, { kind: "user" | "role"; rows: GrantRow[] }>();
  for (const g of grants) {
    const name = g.user_name || g.role_name || "";
    const kind = g.user_name ? "user" : "role";
    let entry = granteeGroups.get(name);
    if (!entry) { entry = { kind, rows: [] }; granteeGroups.set(name, entry); }
    entry.rows.push(g);
  }
  const granteeNames = [...granteeGroups.keys()];

  // ---- Group by privilege (access_type ON object) ----
  const privKey = (g: GrantRow) => `${g.access_type} ON ${g.database || "*"}.${g.table || "*"}${g.column ? `(${g.column})` : ""}`;
  const privGroups = new Map<string, { accessType: string; object: string; rows: GrantRow[] }>();
  for (const g of grants) {
    const key = privKey(g);
    let entry = privGroups.get(key);
    if (!entry) { entry = { accessType: g.access_type, object: `${g.database || "*"}${g.table ? `.${g.table}` : ".*"}${g.column ? ` (${g.column})` : ""}`, rows: [] }; privGroups.set(key, entry); }
    entry.rows.push(g);
  }
  const privKeys = [...privGroups.keys()];

  // Active grouping
  const groupKeys = groupMode === "grantee" ? granteeNames : privKeys;
  const allExpanded = groupKeys.length > 0 && groupKeys.every((k) => expanded.has(k));
  const countLabel = groupMode === "grantee"
    ? `${granteeNames.length} grantee${granteeNames.length === 1 ? "" : "s"}`
    : `${privKeys.length} privilege${privKeys.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
        <TimeframeSelector
          options={[{ label: "By grantee", value: "grantee" }, { label: "By privilege", value: "privilege" }]}
          value={groupMode}
          onChange={(v) => { setGroupMode(v); setExpanded(new Set()); }}
        />
        <button onClick={() => setExpanded(new Set(groupKeys))} disabled={allExpanded} className="rounded p-1 hover:bg-[var(--surface-hover)] disabled:opacity-40" title={`Expand all ${groupMode === "grantee" ? "grantees" : "privileges"}`}>
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setExpanded(new Set())} disabled={expanded.size === 0} className="rounded p-1 hover:bg-[var(--surface-hover)] disabled:opacity-40" title="Collapse all">
          <ChevronsDownUp className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto">{countLabel}</span>
      </div>

      {/* --- By grantee --- */}
      {groupMode === "grantee" && granteeNames.map((name) => {
        const { kind, rows } = granteeGroups.get(name)!;
        const open = expanded.has(name);
        return (
          <div key={name} className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)]">
            <button onClick={() => toggle(name)} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-hover)]">
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-90" : ""}`} />
              {kind === "user" ? <Users className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" /> : <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" />}
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{name}</span>
              <Badge variant="default">{kind}</Badge>
              <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{rows.length} grant{rows.length === 1 ? "" : "s"}</span>
            </button>
            {open && (
              <div className="border-t border-[var(--color-border)]">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                    <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Access</th>
                    <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Object</th>
                    <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Flags</th>
                    <th className="px-4 py-2" />
                  </tr></thead>
                  <tbody>
                    {rows.map((g, i) => (
                      <tr key={`${g.access_type}-${g.database}-${g.table}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-[var(--color-text-primary)]">{g.access_type}</td>
                        <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                          {g.database || "*"}{g.table ? `.${g.table}` : ".*"}{g.column ? ` (${g.column})` : ""}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            {g.grant_option === 1 && (
                              <Badge variant="secondary">
                                <span title="WITH GRANT OPTION — the grantee may re-grant this privilege to others">
                                  <BadgeCheck className="mr-0.5 inline h-3 w-3" />grant option
                                </span>
                              </Badge>
                            )}
                            {g.is_partial_revoke === 1 && <Badge variant="warning">partial revoke</Badge>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
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
              </div>
            )}
          </div>
        );
      })}

      {/* --- By privilege --- */}
      {groupMode === "privilege" && privKeys.map((key) => {
        const { accessType, object, rows } = privGroups.get(key)!;
        const open = expanded.has(key);
        return (
          <div key={key} className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)]">
            <button onClick={() => toggle(key)} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--surface-hover)]">
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? "rotate-90" : ""}`} />
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{accessType}</span>
              <span className="font-mono text-xs text-[var(--color-text-secondary)]">on {object}</span>
              <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{rows.length} grantee{rows.length === 1 ? "" : "s"}</span>
            </button>
            {open && (
              <div className="flex flex-wrap gap-1 border-t border-[var(--color-border)] p-3">
                {rows.map((g, i) => {
                  const name = g.user_name || g.role_name || "";
                  const isUser = !!g.user_name;
                  return isUser ? (
                    <Link key={i} to={`/queries?user=${encodeURIComponent(name)}`} title={`Show queries by ${name}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                      <Users className="h-2.5 w-2.5" />{name}
                      {g.grant_option === 1 && <BadgeCheck className="h-2.5 w-2.5" />}
                    </Link>
                  ) : (
                    <button key={i} onClick={() => onRoleClick(name)} title={`Show role ${name}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                      <KeyRound className="h-2.5 w-2.5" />{name}
                      {g.grant_option === 1 && <BadgeCheck className="h-2.5 w-2.5" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuotaTab({ rows, definitions }: { rows: QuotaUsageRow[]; definitions: QuotaDef[] }) {
  const sort = useTableSort<"quota" | "queries" | "errors" | "read" | "result">("queries", "desc");
  const sorted = useMemo(() => {
    if (!sort.field) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    const by = (q: QuotaUsageRow): number | string => {
      switch (sort.field) {
        case "queries": return q.queries;
        case "errors": return q.errors;
        case "read": return q.read_rows;
        case "result": return q.result_rows;
        default: return q.quota_name || q.quota_key || "";
      }
    };
    return [...rows].sort((a, b) => {
      const va = by(a), vb = by(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [rows, sort.field, sort.dir]);

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
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10"><tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
              <SortableHeader field="quota" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Quota" className="px-4 py-2.5 text-xs" />
              <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Key</th>
              <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Window</th>
              <SortableHeader field="queries" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Queries" className="px-4 py-2.5 text-xs" />
              <SortableHeader field="errors" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Errors" className="px-4 py-2.5 text-xs" />
              <SortableHeader field="read" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Read" className="px-4 py-2.5 text-xs" />
              <SortableHeader field="result" activeField={sort.field} dir={sort.dir} onToggle={sort.toggle} label="Result" className="px-4 py-2.5 text-xs" />
            </tr></thead>
            <tbody>
              {sorted.map((q, i) => (
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
        </div>
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
