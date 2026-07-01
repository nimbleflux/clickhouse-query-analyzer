import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { QueryList } from "./pages/QueryList";
import { QueryDetail } from "./pages/QueryDetail";
import { QueryCompare } from "./pages/QueryCompare";
import { QueryEditor } from "./pages/QueryEditor";
import { TableOptimizer } from "./pages/TableOptimizer";
import { RunningQueries } from "./pages/RunningQueries";
import { QueryFingerprints } from "./pages/QueryFingerprints";
import { FingerprintDetail } from "./pages/FingerprintDetail";
import { Dashboard } from "./pages/Dashboard";
import { Replication } from "./pages/Replication";
import { DDL } from "./pages/DDL";
import { Mutations } from "./pages/Mutations";
import { Merges } from "./pages/Merges";
import { UsersAccess } from "./pages/UsersAccess";
import { SystemMetrics } from "./pages/SystemMetrics";
import { Trends } from "./pages/Trends";
import { loadConnection, saveConnection, setConnectionHeaders, clearConnectionHeaders, DEFAULT_CONNECTION } from "./api/connection";
import type { ConnectionParams } from "./api/connection";
import { testConnection, fetchServerConfig } from "./api/client";

function App() {
  const [connected, setConnected] = useState(false);
  const [connectionParams, setConnectionParams] = useState<ConnectionParams>(loadConnection);

  const tryConnect = useCallback(async (params: ConnectionParams) => {
    setConnectionHeaders(params);
    try {
      await testConnection();
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    const saved = loadConnection();
    const hasSavedConnection = !!localStorage.getItem("ch-query-analyzer-connection");
    const userChoseExplicitly = hasSavedConnection && saved.url !== DEFAULT_CONNECTION.url;

    let cancelled = false;

    // Always fetch server config — the operator may have set CLICKHOUSE_URL
    // etc. that should pre-fill (or override a stale localhost default).
    fetchServerConfig()
      .then((config) => {
        if (cancelled) return;
        const dc = config.default_connection;

        if (dc && !userChoseExplicitly) {
          // No saved connection, or saved connection is the unchanged default
          // (localhost:9000) — use the server's URL instead.
          const params: ConnectionParams = {
            url: dc.url,
            user: dc.user || "default",
            password: "",
            database: dc.database || "system",
            skip_tls: dc.skip_tls,
            readonly: false,
          };
          setConnectionParams(params);
          if (dc.has_password) {
            // Server has full credentials — auto-connect.
            tryConnect(params);
          } else if (hasSavedConnection) {
            // No server password, but user has saved creds — try those.
            tryConnect(saved);
          }
        } else if (hasSavedConnection && saved.url) {
          // User explicitly chose a different URL — respect their choice.
          tryConnect(saved);
        }
      })
      .catch(() => {
        // Server config unavailable — fall back to saved connection or defaults.
        if (hasSavedConnection && saved.url) {
          tryConnect(saved);
        }
      });

    return () => { cancelled = true; };
  }, [tryConnect]);

  const handleConnect = (params: ConnectionParams) => {
    saveConnection(params);
    setConnectionParams(params);
    setConnectionHeaders(params);
    setConnected(true);
  };

  const handleDisconnect = () => {
    clearConnectionHeaders();
    setConnected(false);
  };

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route
            element={
              <Layout
                connection={connectionParams}
                connected={connected}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
              />
            }
          >
            <Route path="/" element={<Dashboard connected={connected} />} />
            <Route path="/queries" element={<QueryList connected={connected} />} />
            <Route path="/editor" element={<QueryEditor connected={connected} />} />
            <Route path="/query/:queryId" element={<QueryDetail connected={connected} />} />
            <Route path="/compare" element={<QueryCompare connected={connected} />} />
            <Route path="/optimizer" element={<TableOptimizer connected={connected} />} />
            <Route path="/optimizer/:db/:table" element={<TableOptimizer connected={connected} />} />
            <Route path="/running" element={<RunningQueries connected={connected} />} />
            <Route path="/fingerprints" element={<QueryFingerprints connected={connected} />} />
            <Route path="/fingerprints/:hash" element={<FingerprintDetail connected={connected} />} />
            <Route path="/replication" element={<Replication connected={connected} />} />
            <Route path="/ddl" element={<DDL connected={connected} />} />
            <Route path="/mutations" element={<Mutations connected={connected} />} />
            <Route path="/merges" element={<Merges connected={connected} />} />
            <Route path="/access" element={<UsersAccess connected={connected} />} />
            <Route path="/system-metrics" element={<SystemMetrics connected={connected} />} />
            <Route path="/trends" element={<Trends connected={connected} />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
