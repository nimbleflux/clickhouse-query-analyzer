import React, { useState, useEffect } from "react";
import { Link, Outlet } from "react-router-dom";
import { Plug, Unplug, Loader2, AlertCircle, GitCompare, Code, Sun, Moon, Wrench, List, Activity, Fingerprint, Gauge } from "lucide-react";
import type { ConnectionParams } from "../api/connection";
import { setConnectionHeaders } from "../api/connection";
import { testConnection } from "../api/client";
import { ThemeContext } from "../api/theme";

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

  const handleConnect = async () => {
    setTesting(true);
    setError("");
    setConnectionHeaders(params);
    try {
      await testConnection();
      onConnect(params);
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
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <nav className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
              <Link to="/" className="flex items-center gap-2 text-[var(--color-text-primary)] no-underline">
                <svg className="h-7 w-7 text-[var(--color-accent)]" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M16 3L3 15v13h26V15L16 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
                  <rect x="9.5" y="20" width="3.5" height="6" rx="1" fill="currentColor"/>
                  <rect x="14.25" y="16" width="3.5" height="10" rx="1" fill="currentColor"/>
                  <rect x="19" y="18" width="3.5" height="8" rx="1" fill="currentColor"/>
                </svg>
                <span className="text-lg font-semibold">ClickHouse Query Analyzer</span>
              </Link>
            <div className="flex items-center gap-4 text-sm">
              {connected && (
                <>
                  <Link to="/" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <Gauge className="h-3.5 w-3.5" />
                    Dashboard
                  </Link>
                  <Link to="/queries" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <List className="h-3.5 w-3.5" />
                    Queries
                  </Link>
                  <Link to="/running" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <Activity className="h-3.5 w-3.5" />
                    Running
                  </Link>
                  <Link to="/fingerprints" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <Fingerprint className="h-3.5 w-3.5" />
                    Fingerprints
                  </Link>
                  <Link to="/editor" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <Code className="h-3.5 w-3.5" />
                    Editor
                  </Link>
                  <Link to="/compare" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <GitCompare className="h-3.5 w-3.5" />
                    Compare
                  </Link>
                  <Link to="/optimizer" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                    <Wrench className="h-3.5 w-3.5" />
                    Optimizer
                  </Link>
                </>
              )}
              {connected && !editing && (
                <>
                  <button
                    onClick={toggleTheme}
                    className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                  >
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => { onDisconnect(); setEditing(true); }}
                    className="flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{params.user}@{params.url.replace(/^[a-z]+:\/\//, "")}</span>
                  </button>
                </>
              )}
              {!connected || editing ? (
                <button
                  onClick={toggleTheme}
                  className="rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </nav>

      {editing && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <Plug className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              value={params.url}
              onChange={(e) => setParams((p) => ({ ...p, url: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="clickhouse://host:9000 or https://host:8443"
              title="Native: clickhouse://host:port or clickhouses://host:port for TLS&#10;HTTP: http://host:port or https://host:port"
              className="w-56 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <input
              type="text"
              value={params.user}
              onChange={(e) => setParams((p) => ({ ...p, user: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="Username"
              className="w-28 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <input
              type="password"
              value={params.password}
              onChange={(e) => setParams((p) => ({ ...p, password: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="Password"
              className="w-32 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <input
              type="text"
              value={params.database}
              onChange={(e) => setParams((p) => ({ ...p, database: e.target.value }))}
              onKeyDown={handleKeyDown}
              placeholder="Database"
              className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <label className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={params.skip_tls}
                onChange={(e) => setParams((p) => ({ ...p, skip_tls: e.target.checked }))}
                className="rounded"
              />
              Skip TLS verify
            </label>
            <button
              onClick={handleConnect}
              disabled={testing || !params.url}
              className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Connect
            </button>
            {error && (
              <span className="flex items-center gap-1 text-xs text-[var(--color-error)]">
                <AlertCircle className="h-3 w-3" />
                {error}
              </span>
            )}
          </div>
        </div>
      )}

      <main>
        <ThemeContext.Provider value={theme}>
          <Outlet />
        </ThemeContext.Provider>
      </main>
    </div>
  );
}
