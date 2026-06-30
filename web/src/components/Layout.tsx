import React, { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Plug, Loader2, AlertCircle, GitCompare, Code, Sun, Moon, Wrench, List, Activity, Fingerprint, Gauge, Menu, X, Network, Layers, FlaskConical, ChevronRight, PanelLeft, PanelLeftClose, GitMerge, Users, BarChart3, type LucideIcon } from "lucide-react";
import type { ConnectionParams } from "../api/connection";
import { setConnectionHeaders } from "../api/connection";
import { testConnection } from "../api/client";
import { ThemeContext } from "../api/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";

interface NavItemDef { to: string; icon: LucideIcon; label: string; end?: boolean }
interface NavSectionDef { label: string; items: NavItemDef[] }

// Grouped nav for the sidebar. System is first (Dashboard is the landing page);
// Tools second so the SQL Editor is prominent. New ops pages (Merges, System
// Metrics, Users & Access) slot into these sections as they ship.
const NAV_SECTIONS: NavSectionDef[] = [
  {
    label: "System",
    items: [
      { to: "/", icon: Gauge, label: "Dashboard", end: true },
      { to: "/replication", icon: Network, label: "Replication" },
      { to: "/ddl", icon: Layers, label: "DDL" },
      { to: "/mutations", icon: FlaskConical, label: "Mutations" },
      { to: "/merges", icon: GitMerge, label: "Merges" },
      { to: "/system-metrics", icon: BarChart3, label: "System Metrics" },
    ],
  },
  {
    label: "Tools",
    items: [{ to: "/editor", icon: Code, label: "SQL Editor" }],
  },
  {
    label: "Queries",
    items: [
      { to: "/queries", icon: List, label: "Queries" },
      { to: "/running", icon: Activity, label: "Running" },
      { to: "/fingerprints", icon: Fingerprint, label: "Fingerprints" },
      { to: "/compare", icon: GitCompare, label: "Compare" },
    ],
  },
  {
    label: "Schema",
    items: [
      { to: "/optimizer", icon: Wrench, label: "Optimizer" },
      { to: "/access", icon: Users, label: "Users & Access" },
    ],
  },
];

export function Layout({
  connection,
  connected,
  onConnect,
  onDisconnect,
}: {
  connection: ConnectionParams;
  connected: boolean;
  onConnect: (params: ConnectionParams) => void;
  onDisconnect: () => void;
}) {
  const [editing, setEditing] = useState(!connected);
  const [params, setParams] = useState<ConnectionParams>(connection);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("ch-nav-collapsed") === "1"; } catch { return false; }
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("ch-nav-sections") || "{}"); } catch { return {}; }
  });
  const [cluster, setCluster] = useState<string>("");
  const [clusterNote, setClusterNote] = useState<string>("");
  const location = useLocation();

  useEffect(() => { try { localStorage.setItem("ch-nav-collapsed", collapsed ? "1" : "0"); } catch {} }, [collapsed]);
  useEffect(() => { try { localStorage.setItem("ch-nav-sections", JSON.stringify(collapsedSections)); } catch {} }, [collapsedSections]);

  const toggleSection = (label: string) => setCollapsedSections((p) => ({ ...p, [label]: !p[label] }));

  // A section's items match on exact (end) or prefix. Auto-expands the active
  // section so the current page is always visible even if the user folded it.
  const isActiveItem = (item: NavItemDef) =>
    item.end ? location.pathname === item.to : location.pathname === item.to || location.pathname.startsWith(item.to + "/");

  // Sync the form when the parent updates the connection params (e.g. after
  // /api/config resolves with server-side defaults).
  useEffect(() => {
    setParams(connection);
  }, [connection]);

  // Collapse the connection bar once a connection is established (covers the
  // auto-connect path on page refresh, which doesn't go through handleConnect).
  useEffect(() => {
    if (connected) setEditing(false);
  }, [connected]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem("ch-theme") as "dark" | "light") || "dark"; } catch { return "dark"; }
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("ch-theme", next); } catch {}
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>("[data-search-input]");
        searchInput?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleConnect = async () => {
    setTesting(true);
    setError("");
    setConnectionHeaders(params);
    try {
      const res = await testConnection();
      onConnect(params);
      setCluster(res.cluster || "");
      setClusterNote(res.cluster_note || "");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConnect();
  };

  const connectionLabel = `${params.user}@${params.url.replace(/^[a-z]+:\/\//, "")}`;

  const renderNavItem = (item: NavItemDef, rail: boolean, isMobile: boolean) => {
    const active = isActiveItem(item);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={() => isMobile && setMobileMenuOpen(false)}
        title={rail ? item.label : undefined}
        className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium no-underline transition-colors ${
          active
            ? "bg-[var(--state-accent)] text-[var(--color-accent)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!rail && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
  };

  const renderSidebarContent = (rail: boolean, isMobile: boolean) => (
    <>
      {/* Brand */}
      <div className={`flex h-14 shrink-0 items-center gap-2 ${rail ? "justify-center px-2" : "px-3"}`}>
        <NavLink to="/" className="flex items-center gap-2 no-underline" onClick={() => isMobile && setMobileMenuOpen(false)}>
          <svg className="h-7 w-7 shrink-0 text-[var(--color-accent)]" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="13.5" cy="13.5" r="9.5" stroke="currentColor" strokeWidth="2.5" />
            <line x1="20.5" y1="20.5" x2="28.5" y2="28.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="8.5" y="11" width="2.5" height="5" rx="0.75" fill="currentColor" />
            <rect x="12.25" y="8.5" width="2.5" height="7.5" rx="0.75" fill="currentColor" />
            <rect x="16" y="10" width="2.5" height="6" rx="0.75" fill="currentColor" />
          </svg>
          {!rail && <span className="text-lg font-semibold text-[var(--color-text-primary)]">ClickLens</span>}
        </NavLink>
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="ml-auto rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
        {NAV_SECTIONS.map((section) => {
          const sectionCollapsed = rail ? false : !!collapsedSections[section.label];
          return (
            <div key={section.label} className="mb-1">
              {rail ? (
                <div className="mx-1 my-1.5 border-t border-[var(--color-border)]" />
              ) : (
                <button
                  onClick={() => toggleSection(section.label)}
                  className="flex w-full items-center gap-1 rounded px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${sectionCollapsed ? "" : "rotate-90"}`} />
                  {section.label}
                </button>
              )}
              {!sectionCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => renderNavItem(item, rail, isMobile))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom cluster: connection + collapse + theme + github */}
      <div className="shrink-0 border-t border-[var(--color-border)] p-2">
        {connected && !editing ? (
          <button
            onClick={() => { onDisconnect(); setEditing(true); setCluster(""); setClusterNote(""); }}
            title={`Connected — ${connectionLabel}${clusterNote ? " (local mode)" : ""}`}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)] ${rail ? "justify-center" : ""}`}
          >
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            {!rail && (
              <span className="min-w-0 flex-1 text-left truncate">
                {connectionLabel}
                {cluster && <span className="ml-1 rounded bg-[var(--state-accent)] px-1 py-0.5 text-[10px] text-[var(--color-accent)]">{cluster}</span>}
              </span>
            )}
          </button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setEditing(true)} className={`w-full ${rail ? "justify-center px-0" : ""}`} title="Connect">
            <Plug className="h-3.5 w-3.5" />
            {!rail && <span className="ml-1">Connect</span>}
          </Button>
        )}
        <div className={`mt-1 ${rail ? "flex flex-col items-center gap-0.5" : "flex items-center justify-between gap-1"}`}>
          {!isMobile && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <a
            href="https://github.com/nimbleflux/clickhouse-query-analyzer"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub"
            className="rounded p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </div>
      </div>
    </>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-[var(--surface-base)]">
        {/* Desktop sidebar (persistent) */}
        <aside
          className={`hidden md:flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--surface-elevated)] transition-[width] duration-150 ${
            collapsed ? "w-14" : "w-56"
          }`}
        >
          {renderSidebarContent(collapsed, false)}
        </aside>

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
            <aside className="relative flex w-64 max-w-[80vw] flex-col border-r border-[var(--color-border)] bg-[var(--surface-elevated)]">
              {renderSidebarContent(false, true)}
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--surface-card)] px-3 md:hidden">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-semibold text-[var(--color-text-primary)]">ClickLens</span>
          </div>

          {/* Connection editing bar */}
          {editing && (
            <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--surface-card)]">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
                <Plug className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
                <Input
                  value={params.url}
                  onChange={(e) => setParams((p) => ({ ...p, url: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="clickhouse://host:9000 or https://host:8443"
                  title="Native: clickhouse://host:port or clickhouses://host:port for TLS&#10;HTTP: http://host:port or https://host:port"
                  className="w-56"
                />
                <Input
                  value={params.user}
                  onChange={(e) => setParams((p) => ({ ...p, user: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="Username"
                  className="w-28"
                />
                <Input
                  type="password"
                  value={params.password}
                  onChange={(e) => setParams((p) => ({ ...p, password: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="Password"
                  className="w-32"
                />
                <Input
                  value={params.database}
                  onChange={(e) => setParams((p) => ({ ...p, database: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="Database"
                  className="w-24"
                />
                <Checkbox
                  checked={params.skip_tls}
                  onChange={(e) => setParams((p) => ({ ...p, skip_tls: e.target.checked }))}
                  label="Skip TLS verify"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConnect}
                  disabled={testing || !params.url}
                >
                  {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Connect
                </Button>
                {error && (
                  <span className="flex items-center gap-1 text-xs text-[var(--color-error)]">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                  </span>
                )}
              </div>
            </div>
          )}

          <main className="min-h-0 flex-1 overflow-auto">
            <ThemeContext.Provider value={theme}>
              <Outlet />
            </ThemeContext.Provider>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
