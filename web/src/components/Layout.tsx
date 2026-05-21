import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Activity, Plug, Unplug, Loader2, AlertCircle, Radio, GitCompare, Code } from "lucide-react";
import type { ConnectionParams } from "../api/connection";
import { testConnection } from "../api/client";

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
  const location = useLocation();
  const [editing, setEditing] = useState(!connected);
  const [params, setParams] = useState<ConnectionParams>(connection);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    setTesting(true);
    setError("");
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
            <Link to="/" className="flex items-center gap-2 text-white no-underline">
              <Activity className="h-6 w-6 text-[var(--color-accent)]" />
              <span className="text-lg font-semibold">ClickHouse Query Analyzer</span>
            </Link>
            <div className="flex items-center gap-4 text-sm">
              {connected && (
                <>
                  <Link to="/editor" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-white">
                    <Code className="h-3.5 w-3.5" />
                    Editor
                  </Link>
                  <Link to="/live" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-white">
                    <Radio className="h-3.5 w-3.5" />
                    Live
                  </Link>
                  <Link to="/compare" className="flex items-center gap-1 no-underline text-[var(--color-text-secondary)] hover:text-white">
                    <GitCompare className="h-3.5 w-3.5" />
                    Compare
                  </Link>
                </>
              )}
              {connected && location.pathname !== "/" && (
                <Link to="/" className="hover:text-white no-underline text-[var(--color-text-secondary)]">
                  &larr; Queries
                </Link>
              )}
              {connected && !editing && (
                <button
                  onClick={() => { onDisconnect(); setEditing(true); }}
                  className="flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-white"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{params.user}@{params.url.replace(/^[a-z]+:\/\//, "")}</span>
                </button>
              )}
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
        <Outlet />
      </main>
    </div>
  );
}
