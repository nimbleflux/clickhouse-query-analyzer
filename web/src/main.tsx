import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import { Layout } from "./components/Layout";
import { QueryList } from "./pages/QueryList";
import { QueryDetail } from "./pages/QueryDetail";
import { QueryCompare } from "./pages/QueryCompare";
import { QueryEditor } from "./pages/QueryEditor";
import { TableOptimizer } from "./pages/TableOptimizer";
import { loadConnection, saveConnection, setConnectionHeaders } from "./api/connection";
import type { ConnectionParams } from "./api/connection";
import { testConnection } from "./api/client";

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
    if (saved.url) {
      tryConnect(saved);
    }
  }, [tryConnect]);

  const handleConnect = (params: ConnectionParams) => {
    saveConnection(params);
    setConnectionParams(params);
    setConnectionHeaders(params);
    setConnected(true);
  };

  const handleDisconnect = () => {
    setConnected(false);
  };

  return (
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
          <Route path="/" element={<QueryList connected={connected} />} />
          <Route path="/editor" element={<QueryEditor />} />
          <Route path="/query/:queryId" element={<QueryDetail />} />
          <Route path="/compare" element={<QueryCompare />} />
          <Route path="/optimizer" element={<TableOptimizer connected={connected} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
