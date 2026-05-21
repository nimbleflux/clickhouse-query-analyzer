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
  SchemaInfo,
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

export async function executeQuery(query: string, maxRows = 1000): Promise<QueryResult> {
  return fetchJSON<QueryResult>(`${BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_rows: maxRows }),
  });
}

export async function fetchSchema(): Promise<SchemaInfo> {
  return fetchJSON<SchemaInfo>(`${BASE}/schema`);
}
