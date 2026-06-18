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
import { loadConnection, saveConnection, setConnectionHeaders, clearConnectionHeaders } from "./api/connection";
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

    if (hasSavedConnection && saved.url) {
      // User has a saved connection — use it (existing behavior).
      tryConnect(saved);
      return;
    }

    // No saved connection — check if the server has env-var-configured defaults.
    let cancelled = false;
    fetchServerConfig()
      .then((config) => {
        if (cancelled || !config.default_connection) return;
        const dc = config.default_connection;
        const params: ConnectionParams = {
          url: dc.url,
          user: dc.user || "default",
          password: "",
          database: dc.database || "system",
          skip_tls: dc.skip_tls,
          readonly: false,
        };
        setConnectionParams(params);
        // If the server has a password configured, we can auto-connect without
        // the user entering anything — the backend fills in the password.
        if (dc.has_password) {
          tryConnect(params);
        }
      })
      .catch(() => { /* server config unavailable — fall back to defaults */ });

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
