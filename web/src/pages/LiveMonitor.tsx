import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Wifi, WifiOff } from "lucide-react";
import type { QueryLogEntry } from "../api/types";
import { getConnectionHeaders } from "../api/connection";
import { formatDuration, formatBytes, formatNumber, formatTime, durationColor, memoryColor } from "../utils";

export function LiveMonitor() {
  const navigate = useNavigate();
  const [queries, setQueries] = useState<QueryLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/api/live`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) return;
        if (data.queries && data.queries.length > 0) {
          setQueries((prev) => {
            const existingIds = new Set(prev.map((q) => q.query_id));
            const newQs = data.queries.filter((q: QueryLogEntry) => !existingIds.has(q.query_id));
            return [...newQs, ...prev].slice(0, 100);
          });
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  const sendHeaders = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ headers: getConnectionHeaders() }));
    }
  };

  useEffect(() => { sendHeaders(); }, [connected]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className={`h-5 w-5 ${connected ? "text-[var(--color-success)] animate-pulse" : "text-[var(--color-text-secondary)]"}`} />
          <h1 className="text-2xl font-bold">Live Monitor</h1>
        </div>
        <span className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
          {connected ? (
            <><Wifi className="h-4 w-4 text-[var(--color-success)]" /> Connected</>
          ) : (
            <><WifiOff className="h-4 w-4" /> Disconnected</>
          )}
        </span>
      </div>

      {queries.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--color-text-secondary)]">
          Waiting for queries... Run a query in ClickHouse to see it appear here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">Time</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">Duration</th>
                <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">Memory</th>
                <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">Rows Read</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">User</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--color-text-secondary)]">Query</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr
                  key={q.query_id}
                  onClick={() => navigate(`/query/${q.query_id}`)}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                    {formatTime(q.query_start_time)}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 font-mono text-xs ${durationColor(q.query_duration_ms)}`}>
                    {formatDuration(q.query_duration_ms)}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right font-mono text-xs ${memoryColor(q.memory_usage)}`}>
                    {formatBytes(q.memory_usage)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-[var(--color-text-secondary)]">
                    {formatNumber(q.read_rows)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-secondary)]">{q.user}</td>
                  <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                    {q.query}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
