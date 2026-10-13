import type {
  SchemaGraphData,
  QueryListParams,
  QueryListResponse,
  QueryLogEntry,
  MetricPoint,
  ThreadEntry,
  TraceEntry,
  ViewLogEntry,
  ExplainResult,
  ExplainAnalyze,
  FlameGraphData,
  ThreadSummary,
  ThreadProfile,
  QueryResult,
  QueryProgress,
  ExecuteStreamEvent,
  TableAnalysis,
  BulkEvent,
  ProcessEntry,
  MutationDetail,
  MergeDetail,
  AccessOverview,
  AsyncMetricsOverview,
  QueryHealthPoint,
  FingerprintListResponse,
  DashboardData,
  TrendPoint,
  FingerprintQueriesResponse,
  ReplicationStatus,
  DDLStatus,
} from "./types";
import { getConnectionHeaders } from "./connection";
import { ApiError, type ApiErrorCode } from "./errors";

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
  cluster_note?: string;
};

export type ServerConfig = {
  default_connection?: {
    url: string;
    user: string;
    database: string;
    has_password: boolean;
    skip_tls: boolean;
  };
};

export async function fetchServerConfig(signal?: AbortSignal): Promise<ServerConfig> {
  return fetchJSON<ServerConfig>(`${BASE}/config`, { signal });
}

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

export async function fetchExplain(queryId: string, pretty = false, signal?: AbortSignal): Promise<ExplainResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/queries/${encodeURIComponent(queryId)}/explain${pretty ? "?pretty=1" : ""}`, {
      method: "POST",
      headers: { ...getConnectionHeaders(), "Content-Type": "application/json" },
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

export async function fetchExplainAnalyze(
  queryId: string,
  processors = false,
  signal?: AbortSignal,
): Promise<ExplainAnalyze> {
  const sp = processors ? "?processors=1" : "";
  let res: Response;
  try {
    res = await fetch(`${BASE}/queries/${encodeURIComponent(queryId)}/explain-analyze${sp}`, {
      method: "POST",
      headers: { ...getConnectionHeaders(), "Content-Type": "application/json" },
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

export async function executeQuery(
  query: string,
  limit: number,
  offset: number,
  settings?: Record<string, string>,
  readonly = false,
  signal?: AbortSignal,
  onProgress?: (p: QueryProgress) => void,
  onStarted?: (queryId: string) => void,
  params?: Record<string, string>,
): Promise<QueryResult> {
  const headers: Record<string, string> = {
    ...getConnectionHeaders(),
    "Content-Type": "application/json",
  };
  if (readonly) {
    headers["X-CH-Readonly"] = "1";
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, limit, offset, settings, params }),
      signal,
    });
  } catch (e) {
    throw ApiError.wrap(e);
  }
  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }

  // Consume the NDJSON event stream: started → progress* → result|error.
  // The first event arrives before the query runs, which keeps reverse-proxy
  // read timeouts from firing on long-running queries.
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
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt: ExecuteStreamEvent;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        continue;
      }
      switch (evt.type) {
        case "started":
          if (evt.query_id) onStarted?.(evt.query_id);
          break;
        case "progress":
          if (evt.progress) onProgress?.(evt.progress);
          break;
        case "result":
          return evt.result!;
        case "error": {
          const e = evt.error;
          const code = (e?.code ?? "CH_EXCEPTION") as ApiErrorCode;
          const status = code === "QUERY_TIMEOUT" ? 504 : 502;
          throw new ApiError(e?.error || "Query failed", status, code, e?.hint ?? "", e?.retry ?? false);
        }
      }
    }
  }
  throw new ApiError("Query stream ended without a result", 0, "NETWORK_ERROR", "", true);
}

/**
 * Kill an in-flight editor query server-side by its query_id. Best-effort:
 * failures are swallowed because the request abort itself also triggers a
 * server-side kill (the backend watches for client disconnects).
 */
export async function cancelExecuteQuery(queryId: string): Promise<void> {
  try {
    await fetchJSON(`${BASE}/execute/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query_id: queryId }),
    });
  } catch {
    // best-effort
  }
}

/**
 * Explicitly count the total rows of a user query (`SELECT count() FROM (q)`).
 * This no longer happens automatically on the first page — it silently
 * doubled the cost of heavy queries (e.g. a second full S3 scan).
 */
export async function countQueryRows(query: string, signal?: AbortSignal): Promise<number> {
  const res = await fetchJSON<{ count: number }>(`${BASE}/execute/count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  return res.count;
}

export type DetachedJob = {
  id: string;
  query_id: string;
  statement: string;
  status: "running" | "done" | "error" | "canceled";
  result?: QueryResult;
  error?: { error?: string; code?: string; hint?: string; retry?: boolean };
  progress?: QueryProgress;
  started_at: string;
  finished_at?: string;
};

/** Run a statement detached: it outlives the HTTP request; poll for status. */
export async function executeDetached(
  query: string,
  limit: number,
  offset: number,
  settings?: Record<string, string>,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ job_id: string; query_id: string }> {
  return fetchJSON(`${BASE}/execute`, {
    method: "POST",
    headers: { ...getConnectionHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, offset, settings, params, detached: true }),
    signal,
  });
}

export async function fetchJob(jobId: string, signal?: AbortSignal): Promise<DetachedJob> {
  return fetchJSON(`${BASE}/jobs/${encodeURIComponent(jobId)}`, { signal });
}

export async function cancelJob(jobId: string, signal?: AbortSignal): Promise<{ status: string }> {
  return fetchJSON(`${BASE}/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function fetchSchemaGraph(
  loadDays: number,
  signal?: AbortSignal,
): Promise<SchemaGraphData> {
  const qs = loadDays > 0 ? `?load_days=${loadDays}` : "";
  return fetchJSON(`${BASE}/schema/graph${qs}`, { signal });
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
  return fetchJSON<{ status: string }>(`${BASE}/processes/${encodeURIComponent(queryId)}/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function killProcessesByUser(user: string, signal?: AbortSignal): Promise<{ status: string; killed: number; user: string }> {
  return fetchJSON<{ status: string; killed: number; user: string }>(`${BASE}/processes/kill-by-user?user=${encodeURIComponent(user)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function fetchMutations(signal?: AbortSignal): Promise<MutationDetail[]> {
  return fetchJSON<MutationDetail[]>(`${BASE}/mutations`, { signal });
}

export async function killMutation(database: string, table: string, mutationId: string, signal?: AbortSignal): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/mutations/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ database, table, mutation_id: mutationId }),
    signal,
  });
}

export async function fetchMerges(signal?: AbortSignal): Promise<MergeDetail[]> {
  return fetchJSON<MergeDetail[]>(`${BASE}/merges`, { signal });
}

export async function fetchAccess(signal?: AbortSignal): Promise<AccessOverview> {
  return fetchJSON<AccessOverview>(`${BASE}/access`, { signal });
}

export async function dropUser(name: string, signal?: AbortSignal): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/access/users/${encodeURIComponent(name)}/drop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function dropRole(name: string, signal?: AbortSignal): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/access/roles/${encodeURIComponent(name)}/drop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function revokeGrant(
  granteeKind: string, grantee: string, accessType: string,
  database: string, table: string, column: string, grantOption: boolean,
  signal?: AbortSignal,
): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>(`${BASE}/access/grants/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantee_kind: granteeKind, grantee, access_type: accessType, database, table, column, grant_option: grantOption }),
    signal,
  });
}

export async function fetchAsyncMetrics(signal?: AbortSignal): Promise<AsyncMetricsOverview> {
  return fetchJSON<AsyncMetricsOverview>(`${BASE}/system-metrics`, { signal });
}

export async function fetchTableDDL(database: string, table: string, signal?: AbortSignal): Promise<{ statement: string }> {
  return fetchJSON<{ statement: string }>(`${BASE}/schema/${encodeURIComponent(database)}/${encodeURIComponent(table)}/ddl`, { signal });
}

export async function fetchUserGrants(name: string, signal?: AbortSignal): Promise<{ statement: string }> {
  return fetchJSON<{ statement: string }>(`${BASE}/access/users/${encodeURIComponent(name)}/grants`, { signal });
}

export async function fetchRoleGrants(name: string, signal?: AbortSignal): Promise<{ statement: string }> {
  return fetchJSON<{ statement: string }>(`${BASE}/access/roles/${encodeURIComponent(name)}/grants`, { signal });
}

export async function fetchQueryHealthTrend(hours: number, signal?: AbortSignal): Promise<QueryHealthPoint[]> {
  return fetchJSON<QueryHealthPoint[]>(`${BASE}/queries/health-trend?hours=${hours}`, { signal });
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

export async function fetchReplication(params?: { database?: string; include_history?: boolean; limit?: number; offset?: number }, signal?: AbortSignal): Promise<ReplicationStatus> {
  const sp = new URLSearchParams();
  if (params?.database) sp.set("database", params.database);
  if (params?.include_history === false) sp.set("include_history", "false");
  if (params?.limit) sp.set("limit", String(params.limit));
  if (params?.offset) sp.set("offset", String(params.offset));
  const qs = sp.toString();
  return fetchJSON<ReplicationStatus>(`${BASE}/replication${qs ? `?${qs}` : ""}`, { signal });
}

export async function fetchDDL(params?: { database?: string; hours?: number; limit?: number }, signal?: AbortSignal): Promise<DDLStatus> {
  const sp = new URLSearchParams();
  if (params?.database) sp.set("database", params.database);
  if (params?.hours !== undefined) sp.set("hours", String(params.hours));
  if (params?.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return fetchJSON<DDLStatus>(`${BASE}/ddl${qs ? `?${qs}` : ""}`, { signal });
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
