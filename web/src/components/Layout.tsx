import React, { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Plug, Unplug, Loader2, AlertCircle, GitCompare, Code, Sun, Moon, Wrench, List, Activity, Fingerprint, Gauge, Menu, X } from "lucide-react";
import type { ConnectionParams } from "../api/connection";
import { setConnectionHeaders } from "../api/connection";
import { testConnection } from "../api/client";
import { ThemeContext } from "../api/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { to: "/", icon: Gauge, label: "Dashboard", end: true },
  { to: "/queries", icon: List, label: "Queries", end: false },
  { to: "/running", icon: Activity, label: "Running", end: false },
  { to: "/fingerprints", icon: Fingerprint, label: "Fingerprints", end: false },
  { to: "/editor", icon: Code, label: "Editor", end: false },
  { to: "/compare", icon: GitCompare, label: "Compare", end: false },
  { to: "/optimizer", icon: Wrench, label: "Optimizer", end: false },
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
  const [cluster, setCluster] = useState<string>("");
  const location = useLocation();

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

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen flex flex-col bg-[var(--surface-base)]">
        <nav className="shrink-0 border-b border-[var(--color-border)] bg-[var(--surface-card)]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  aria-expanded={mobileMenuOpen}
                  aria-label="Toggle navigation menu"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] md:hidden"
                >
                  {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
                <NavLink to="/" className="flex items-center gap-2 text-[var(--color-text-primary)] no-underline">
                  <svg className="h-7 w-7 text-[var(--color-accent)]" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="13.5" cy="13.5" r="9.5" stroke="currentColor" strokeWidth="2.5"/>
                    <line x1="20.5" y1="20.5" x2="28.5" y2="28.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    <rect x="8.5" y="11" width="2.5" height="5" rx="0.75" fill="currentColor"/>
                    <rect x="12.25" y="8.5" width="2.5" height="7.5" rx="0.75" fill="currentColor"/>
                    <rect x="16" y="10" width="2.5" height="6" rx="0.75" fill="currentColor"/>
                  </svg>
                  <span className="text-lg font-semibold">ClickLens</span>
                </NavLink>
              </div>

              <div className="hidden items-center gap-1 text-sm md:flex">
                {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium no-underline transition-colors ${
                        isActive
                          ? "bg-[var(--state-accent)] text-[var(--color-accent)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
                      }`
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </NavLink>
                ))}
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleTheme}
                  title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                {connected && !editing && (
                  <button
                    onClick={() => { onDisconnect(); setEditing(true); setCluster(""); }}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
                    title="Connected — click to disconnect"
                  >
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    <Unplug className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{params.user}@{params.url.replace(/^[a-z]+:\/\//, "")}</span>
                    {cluster && (
                      <span className="hidden rounded bg-[var(--state-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] sm:inline">
                        {cluster}
                      </span>
                    )}
                  </button>
                )}
                {!connected && !editing && (
                  <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
                    <Plug className="h-3 w-3" />
                    Connect
                  </Button>
                )}
              </div>
            </div>
          </div>

          {mobileMenuOpen && (
            <div className="border-t border-[var(--color-border)] md:hidden">
              <div className="flex flex-col gap-1 px-4 py-2">
                {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded-md px-3 py-2 no-underline text-sm transition-colors ${
                        isActive
                          ? "bg-[var(--state-accent)] text-[var(--color-accent)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>

        {editing && (
          <div className="border-b border-[var(--color-border)] bg-[var(--surface-card)]">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
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

        <main className="flex-1 min-h-0 overflow-auto">
          <ThemeContext.Provider value={theme}>
            <Outlet />
          </ThemeContext.Provider>
        </main>
      </div>
    </TooltipProvider>
  );
}
