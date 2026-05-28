import type {
  QueryListParams,
  QueryListResponse,
  QueryLogEntry,
  MetricPoint,
  ThreadEntry,
  TraceEntry,
  ViewLogEntry,
  ExplainResult,
  FlameGraphData,
  ThreadSummary,
  ThreadProfile,
  QueryResult,
  TableAnalysis,
  BulkEvent,
  ProcessEntry,
  FingerprintListResponse,
  DashboardData,
  TrendPoint,
  FingerprintQueriesResponse,
} from "./types";
import { getConnectionHeaders } from "./connection";

const BASE = "/api";

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...getConnectionHeaders(),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function testConnection(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/connect`, { method: "POST" });
}

export async function fetchQueries(params: QueryListParams): Promise<QueryListResponse> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return fetchJSON<QueryListResponse>(`${BASE}/queries?${sp}`);
}

export async function fetchQuery(queryId: string): Promise<QueryLogEntry> {
  return fetchJSON<QueryLogEntry>(`${BASE}/queries/${encodeURIComponent(queryId)}`);
}

export async function fetchQueryMetrics(queryId: string): Promise<MetricPoint[]> {
  return fetchJSON<MetricPoint[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/metrics`);
}

export async function fetchQueryThreads(queryId: string): Promise<ThreadEntry[]> {
  return fetchJSON<ThreadEntry[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads`);
}

export async function fetchTrace(queryId: string, type?: string): Promise<TraceEntry[]> {
  const sp = type ? `?type=${encodeURIComponent(type)}` : "";
  return fetchJSON<TraceEntry[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/trace${sp}`);
}

export async function fetchQueryViews(queryId: string): Promise<ViewLogEntry[]> {
  return fetchJSON<ViewLogEntry[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/views`);
}

export async function fetchFlameGraph(queryId: string, type?: string): Promise<FlameGraphData[]> {
  const sp = type ? `?type=${encodeURIComponent(type)}` : "";
  return fetchJSON<FlameGraphData[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/flamegraph${sp}`);
}

export async function fetchComparison(idA: string, idB: string): Promise<{ a: QueryLogEntry; b: QueryLogEntry }> {
  return fetchJSON<{ a: QueryLogEntry; b: QueryLogEntry }>(`${BASE}/compare?a=${encodeURIComponent(idA)}&b=${encodeURIComponent(idB)}`);
}

export async function fetchExplain(queryId: string): Promise<ExplainResult> {
  const res = await fetch(`${BASE}/queries/${encodeURIComponent(queryId)}/explain`, {
    method: "POST",
    headers: getConnectionHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function fetchThreadSummaries(queryId: string): Promise<ThreadSummary[]> {
  return fetchJSON<ThreadSummary[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads/summaries`);
}

export async function fetchThreadProfile(queryId: string, threadId: number): Promise<ThreadProfile> {
  return fetchJSON<ThreadProfile>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads/${threadId}/profile`);
}

export async function executeQuery(query: string, maxRows = 1000, settings?: Record<string, string>): Promise<QueryResult> {
  return fetchJSON<QueryResult>(`${BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_rows: maxRows, settings }),
  });
}

export async function fetchDatabases(): Promise<{ databases: string[] }> {
  return fetchJSON<{ databases: string[] }>(`${BASE}/schema`);
}

export async function fetchTables(db: string): Promise<{ tables: { name: string; engine: string; row_count: number }[] }> {
  return fetchJSON(`${BASE}/schema/${encodeURIComponent(db)}/tables`);
}

export async function fetchColumns(db: string, table: string): Promise<{ columns: { name: string; type: string }[] }> {
  return fetchJSON(`${BASE}/schema/${encodeURIComponent(db)}/${encodeURIComponent(table)}/columns`);
}

export async function fetchTableAnalysis(db: string, table: string): Promise<TableAnalysis> {
  return fetchJSON<TableAnalysis>(`${BASE}/optimizer/${encodeURIComponent(db)}/${encodeURIComponent(table)}`);
}

export function streamBulkAnalysis(
  scope: "database" | "all",
  db: string,
  filters?: { engine?: string; min_rows?: number; min_bytes?: number },
  onEvent?: (event: BulkEvent) => void,
  onError?: (error: Error) => void,
): AbortController {
  const ctrl = new AbortController();
  const params = new URLSearchParams();
  if (filters?.engine) params.set("engine", filters.engine);
  if (filters?.min_rows) params.set("min_rows", String(filters.min_rows));
  if (filters?.min_bytes) params.set("min_bytes", String(filters.min_bytes));

  let url: string;
  if (scope === "database") {
    url = `${BASE}/optimizer/${encodeURIComponent(db)}?${params}`;
  } else {
    url = `${BASE}/optimizer?${params}`;
  }

  (async () => {
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: getConnectionHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt: BulkEvent = JSON.parse(line.slice(6));
              onEvent?.(evt);
            } catch {}
          }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
  })();

  return ctrl;
}

export async function fetchProcesses(): Promise<ProcessEntry[]> {
  return fetchJSON<ProcessEntry[]>(`${BASE}/processes`);
}

export async function killProcess(queryId: string): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/processes/${encodeURIComponent(queryId)}/kill`, { method: "POST" });
}

export async function fetchFingerprints(params: Partial<QueryListParams>): Promise<FingerprintListResponse> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return fetchJSON<FingerprintListResponse>(`${BASE}/queries/fingerprints?${sp}`);
}

export async function fetchDashboard(): Promise<DashboardData> {
  return fetchJSON<DashboardData>(`${BASE}/dashboard`);
}

export async function fetchFingerprintTrend(hash: string, interval?: string, fromTime?: string, toTime?: string): Promise<TrendPoint[]> {
  const sp = new URLSearchParams();
  if (interval) sp.set("interval", interval);
  if (fromTime) sp.set("from_time", fromTime);
  if (toTime) sp.set("to_time", toTime);
  const qs = sp.toString();
  return fetchJSON<TrendPoint[]>(`${BASE}/queries/fingerprints/${hash}/trend${qs ? `?${qs}` : ""}`);
}

export async function fetchFingerprintQueries(hash: string, limit?: number, offset?: number): Promise<FingerprintQueriesResponse> {
  const sp = new URLSearchParams();
  if (limit) sp.set("limit", String(limit));
  if (offset) sp.set("offset", String(offset));
  const qs = sp.toString();
  return fetchJSON<FingerprintQueriesResponse>(`${BASE}/queries/fingerprints/${hash}/queries${qs ? `?${qs}` : ""}`);
}
