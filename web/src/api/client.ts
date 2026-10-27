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

// ---------------------------------------------------------------------------
// Auth token (-auth-token flag on the backend). The token lives in
// sessionStorage (per-tab, cleared on close) and rides along as X-Auth-Token
// on every request, next to the connection headers.
// ---------------------------------------------------------------------------
const AUTH_TOKEN_KEY = "ch-auth-token";

export function getAuthToken(): string {
  try { return sessionStorage.getItem(AUTH_TOKEN_KEY) || ""; } catch { return ""; }
}

export function setAuthToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    else sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}

export function clearAuthToken(): void {
  setAuthToken("");
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { "X-Auth-Token": token } : {};
}

/**
 * Fired when the backend answers 401 with code UNAUTHORIZED. App-level UI
 * (components/AuthDialog.tsx) listens for this and asks for the token.
 */
function notifyUnauthorized(res: Response): void {
  if (res.status !== 401) return;
  res
    .clone()
    .json()
    .then((body: { code?: string; error?: string; hint?: string }) => {
      if (body?.code === "UNAUTHORIZED") {
        window.dispatchEvent(
          new CustomEvent("clicklens:unauthorized", { detail: { error: body.error ?? "", hint: body.hint ?? "" } }),
        );
      }
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Server timezone, captured from the POST /api/connect response at connect
// time. Display-side conversion (browser-zone rendering of server wall-clock
// strings) lives in hooks/useAppSettings.ts.
// ---------------------------------------------------------------------------
const SERVER_TIMEZONE_KEY = "ch-server-timezone";
let serverTimezone = "";
try { serverTimezone = sessionStorage.getItem(SERVER_TIMEZONE_KEY) || ""; } catch {}

const timezoneListeners = new Set<() => void>();

export function setServerTimezone(tz: string): void {
  if (!tz || tz === serverTimezone) return;
  serverTimezone = tz;
  try { sessionStorage.setItem(SERVER_TIMEZONE_KEY, tz); } catch {}
  for (const fn of timezoneListeners) fn();
}

export function getServerTimezone(): string {
  return serverTimezone;
}

/** Subscribe to server-timezone changes (used by useServerTimezone). */
export function subscribeServerTimezone(fn: () => void): () => void {
  timezoneListeners.add(fn);
  return () => timezoneListeners.delete(fn);
}

// Default timeout for JSON requests so a hung request fails after a minute
// instead of spinning forever. Streaming endpoints (executeQuery) opt out —
// progress keeps legitimately long queries alive there.
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Compose the caller's signal with a default timeout. The timeout only arms
 * fetchJSON paths; executeQuery passes its own signal straight through.
 */
function withDefaultTimeout(signal?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: withDefaultTimeout(options?.signal),
      headers: {
        ...getConnectionHeaders(),
        ...authHeaders(),
        ...(options?.headers || {}),
      },
    });
  } catch (e) {
    throw ApiError.wrap(e);
  }
  if (!res.ok) {
    notifyUnauthorized(res);
    throw await ApiError.fromResponse(res);
  }
  try {
    return await res.json();
  } catch {
    // Truncated or non-JSON body (proxy error page, etc.) — keep the error
    // shape consistent with every other failure instead of leaking a raw
    // SyntaxError to callers.
    throw new ApiError("Invalid JSON in server response", res.status, "NETWORK_ERROR", "", true);
  }
}

export type ConnectResponse = {
  status: string;
  cluster?: string;
  is_cluster?: boolean;
  cluster_note?: string;
  /** Server IANA timezone (system.timezone); empty when detection failed. */
  timezone?: string;
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
  const res = await fetchJSON<ConnectResponse>(`${BASE}/connect`, { method: "POST" });
  // Capture the server timezone at the single point every connect flow goes
  // through (main.tsx auto-connect AND the Layout connection bar).
  setServerTimezone(res.timezone || "");
  return res;
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
  return fetchJSON<ExplainResult>(`${BASE}/queries/${encodeURIComponent(queryId)}/explain${pretty ? "?pretty=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function fetchExplainAnalyze(
  queryId: string,
  processors = false,
  signal?: AbortSignal,
): Promise<ExplainAnalyze> {
  return fetchJSON<ExplainAnalyze>(`${BASE}/queries/${encodeURIComponent(queryId)}/explain-analyze${processors ? "?processors=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

export async function fetchThreadSummaries(queryId: string, signal?: AbortSignal): Promise<ThreadSummary[]> {
  return fetchJSON<ThreadSummary[]>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads/summaries`, { signal });
}

export async function fetchThreadProfile(queryId: string, threadId: number, signal?: AbortSignal): Promise<ThreadProfile> {
  return fetchJSON<ThreadProfile>(`${BASE}/queries/${encodeURIComponent(queryId)}/threads/${threadId}/profile`, { signal });
}

/**
 * Go marshals empty slices as JSON null, so a 0-row result can arrive with
 * `rows: null` (and the advisor with null arrays). The editor reads .length
 * on all of these, so normalize at the single point results enter the app.
 */
export function normalizeQueryResult(r: QueryResult): QueryResult {
  return {
    ...r,
    columns: r.columns ?? [],
    rows: r.rows ?? [],
    advisor: r.advisor
      ? {
          ...r.advisor,
          tables: r.advisor.tables ?? [],
          warnings: r.advisor.warnings ?? [],
          suggestions: r.advisor.suggestions ?? [],
        }
      : undefined,
  };
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
  tag?: string,
): Promise<QueryResult> {
  const headers: Record<string, string> = {
    ...getConnectionHeaders(),
    ...authHeaders(),
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
      body: JSON.stringify({ query, limit, offset, settings, params, tag }),
      signal,
    });
  } catch (e) {
    throw ApiError.wrap(e);
  }
  if (!res.ok) {
    notifyUnauthorized(res);
    throw await ApiError.fromResponse(res);
  }

  // Consume the NDJSON event stream: started → progress* → result|error.
  // The first event arrives before the query runs, which keeps reverse-proxy
  // read timeouts from firing on long-running queries.
  if (!res.body) {
    throw new ApiError("Query stream unavailable", res.status, "NETWORK_ERROR", "", true);
  }
  const reader = res.body.getReader();
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
          return normalizeQueryResult(evt.result!);
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
  tag?: string,
): Promise<{ job_id: string; query_id: string }> {
  return fetchJSON(`${BASE}/execute`, {
    method: "POST",
    headers: { ...getConnectionHeaders(), ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, offset, settings, params, tag, detached: true }),
    signal,
  });
}

export async function fetchJob(jobId: string, signal?: AbortSignal): Promise<DetachedJob> {
  const job = await fetchJSON<DetachedJob>(`${BASE}/jobs/${encodeURIComponent(jobId)}`, { signal });
  return { ...job, result: job.result ? normalizeQueryResult(job.result) : undefined };
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
  database: string | null,
  all: boolean,
  signal?: AbortSignal,
): Promise<SchemaGraphData> {
  const sp = new URLSearchParams();
  if (loadDays > 0) sp.set("load_days", String(loadDays));
  if (database) sp.set("database", database);
  if (all) sp.set("all", "1");
  const qs = sp.toString();
  return fetchJSON(`${BASE}/schema/graph${qs ? `?${qs}` : ""}`, { signal });
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
        headers: { ...getConnectionHeaders(), ...authHeaders() },
      });
      if (!res.ok) {
        notifyUnauthorized(res);
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

// ---------------------------------------------------------------------------
// Backups (system.backups) — the Backups page.
// ---------------------------------------------------------------------------

export type BackupEntry = {
  id: string;
  name: string;
  status: string;
  error?: string;
  start_time: string;
  end_time?: string;
  num_files: number;
  total_size: number;
  files_read: number;
  bytes_read: number;
};

export async function fetchBackups(limit = 200, signal?: AbortSignal): Promise<{ backups: BackupEntry[] }> {
  return fetchJSON(`${BASE}/backups?limit=${limit}`, { signal });
}

// ---------------------------------------------------------------------------
// Table parts explorer (system.parts) — /tables/{db}/{table}/parts.
// ---------------------------------------------------------------------------

export type PartDetail = {
  name: string;
  partition: string;
  rows: number;
  bytes_on_disk: number;
  marks: number;
  modification_time: string;
  age_seconds: number;
  primary_key_size_in_memory: number;
  is_committed: number;
};

export type PartsPartitionSummary = {
  partition: string;
  parts: number;
  rows: number;
  bytes_on_disk: number;
};

export type PartsSummary = {
  parts: number;
  rows: number;
  bytes_on_disk: number;
  partition: string;
  per_partition: PartsPartitionSummary[];
};

export type TablePartsResponse = {
  parts: PartDetail[];
  summary: PartsSummary;
  limit: number;
  total_parts: number;
};

export async function fetchTableParts(
  db: string,
  table: string,
  limit = 500,
  signal?: AbortSignal,
): Promise<TablePartsResponse> {
  return fetchJSON(
    `${BASE}/schema/${encodeURIComponent(db)}/${encodeURIComponent(table)}/parts?limit=${limit}`,
    { signal },
  );
}
