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
import { ApiError } from "./errors";

const BASE = "/api";

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        ...getConnectionHeaders(),
        ...(options?.headers || {}),
      },
    });
  } catch (e) {
    throw ApiError.wrap(e);
  }
  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }
  return res.json();
}

export type ConnectResponse = {
  status: string;
  cluster?: string;
  is_cluster?: boolean;
};

export async function testConnection(): Promise<ConnectResponse> {
  return fetchJSON<ConnectResponse>(`${BASE}/connect`, { method: "POST" });
}

export async function fetchQueries(params: QueryListParams, signal?: AbortSignal): Promise<QueryListResponse> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return fetchJSON<QueryListResponse>(`${BASE}/queries?${sp}`, { signal });
}

export async function fetchQuery(queryId: string, signal?: AbortSignal): Promise<QueryLogEntry> {
  return fetchJSON<QueryLogEntry>(`${BASE}/queries/${encodeURIComponent(queryId)}`, { signal });
}

export async function fetchQueryMetrics(queryId: string, signal?: AbortSignal): Promise<MetricPoint[]> {
  return fetchJSON<MetricPoint[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/metrics`, { signal });
}

export async function fetchQueryThreads(queryId: string, signal?: AbortSignal): Promise<ThreadEntry[]> {
  return fetchJSON<ThreadEntry[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads`, { signal });
}

export async function fetchTrace(queryId: string, type?: string, signal?: AbortSignal): Promise<TraceEntry[]> {
  const sp = type ? `?type=${encodeURIComponent(type)}` : "";
  return fetchJSON<TraceEntry[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/trace${sp}`, { signal });
}

export async function fetchQueryViews(queryId: string, signal?: AbortSignal): Promise<ViewLogEntry[]> {
  return fetchJSON<ViewLogEntry[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/views`, { signal });
}

export async function fetchFlameGraph(queryId: string, type?: string, signal?: AbortSignal): Promise<FlameGraphData[]> {
  const sp = type ? `?type=${encodeURIComponent(type)}` : "";
  return fetchJSON<FlameGraphData[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/flamegraph${sp}`, { signal });
}

export async function fetchComparison(idA: string, idB: string, signal?: AbortSignal): Promise<{ a: QueryLogEntry; b: QueryLogEntry }> {
  return fetchJSON<{ a: QueryLogEntry; b: QueryLogEntry }>(`${BASE}/compare?a=${encodeURIComponent(idA)}&b=${encodeURIComponent(idB)}`, { signal });
}

export async function fetchExplain(queryId: string, signal?: AbortSignal): Promise<ExplainResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/queries/${encodeURIComponent(queryId)}/explain`, {
      method: "POST",
      headers: getConnectionHeaders(),
      signal,
    });
  } catch (e) {
    throw ApiError.wrap(e);
  }
  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }
  return res.json();
}

export async function fetchThreadSummaries(queryId: string, signal?: AbortSignal): Promise<ThreadSummary[]> {
  return fetchJSON<ThreadSummary[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads/summaries`, { signal });
}

export async function fetchThreadProfile(queryId: string, threadId: number, signal?: AbortSignal): Promise<ThreadProfile> {
  return fetchJSON<ThreadProfile>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads/${threadId}/profile`, { signal });
}

export async function executeQuery(query: string, maxRows = 1000, settings?: Record<string, string>, readonly = false, signal?: AbortSignal): Promise<QueryResult> {
  const headers: Record<string, string> = {
    ...getConnectionHeaders(),
    "Content-Type": "application/json",
  };
  if (readonly) {
    headers["X-CH-Readonly"] = "1";
  }
  return fetchJSON<QueryResult>(`${BASE}/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, max_rows: maxRows, settings }),
    signal,
  });
}

export async function fetchDatabases(signal?: AbortSignal): Promise<{ databases: string[] }> {
  return fetchJSON<{ databases: string[] }>(`${BASE}/schema`, { signal });
}

export async function fetchTables(db: string, signal?: AbortSignal): Promise<{ tables: { name: string; engine: string; row_count: number }[] }> {
  return fetchJSON(`${BASE}/schema/${encodeURIComponent(db)}/tables`, { signal });
}

export async function fetchColumns(db: string, table: string, signal?: AbortSignal): Promise<{ columns: { name: string; type: string }[] }> {
  return fetchJSON(`${BASE}/schema/${encodeURIComponent(db)}/${encodeURIComponent(table)}/columns`, { signal });
}

export async function fetchTableAnalysis(db: string, table: string, signal?: AbortSignal): Promise<TableAnalysis> {
  return fetchJSON<TableAnalysis>(`${BASE}/optimizer/${encodeURIComponent(db)}/${encodeURIComponent(table)}`, { signal });
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
        throw await ApiError.fromResponse(res);
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
        onError?.(ApiError.wrap(e));
      }
    }
  })();

  return ctrl;
}

export async function fetchProcesses(signal?: AbortSignal): Promise<ProcessEntry[]> {
  return fetchJSON<ProcessEntry[]>(`${BASE}/processes`, { signal });
}

export async function killProcess(queryId: string, signal?: AbortSignal): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/processes/${encodeURIComponent(queryId)}/kill`, { method: "POST", signal });
}

export async function fetchFingerprints(params: Partial<QueryListParams>, signal?: AbortSignal): Promise<FingerprintListResponse> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  return fetchJSON<FingerprintListResponse>(`${BASE}/queries/fingerprints?${sp}`, { signal });
}

export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardData> {
  return fetchJSON<DashboardData>(`${BASE}/dashboard`, { signal });
}

export async function fetchFingerprintTrend(hash: string, interval?: string, fromTime?: string, toTime?: string, signal?: AbortSignal): Promise<TrendPoint[]> {
  const sp = new URLSearchParams();
  if (interval) sp.set("interval", interval);
  if (fromTime) sp.set("from_time", fromTime);
  if (toTime) sp.set("to_time", toTime);
  const qs = sp.toString();
  return fetchJSON<TrendPoint[]>(`${BASE}/queries/fingerprints/${hash}/trend${qs ? `?${qs}` : ""}`, { signal });
}

export async function fetchFingerprintQueries(hash: string, limit?: number, offset?: number, signal?: AbortSignal): Promise<FingerprintQueriesResponse> {
  const sp = new URLSearchParams();
  if (limit) sp.set("limit", String(limit));
  if (offset) sp.set("offset", String(offset));
  const qs = sp.toString();
  return fetchJSON<FingerprintQueriesResponse>(`${BASE}/queries/fingerprints/${hash}/queries${qs ? `?${qs}` : ""}`, { signal });
}

export type LogTableSize = {
  table: string;
  rows: number;
  compressed_bytes: number;
  uncompressed_bytes: number;
  exists: boolean;
  enabled: boolean;
};

export type SettingValue = {
  name: string;
  value: string;
};
