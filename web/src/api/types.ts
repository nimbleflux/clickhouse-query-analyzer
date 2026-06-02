export interface QueryLogEntry {
  type: string;
  event_time: string;
  query_start_time: string;
  query_duration_ms: number;
  query_id: string;
  query: string;
  normalized_query_hash: string;
  query_kind: string;
  user: string;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  result_rows: number;
  result_bytes: number;
  memory_usage: number;
  peak_threads_usage: number;
  exception_code: number;
  exception: string;
  databases: string[];
  tables: string[];
  is_initial_query: number;
  initial_query_id: string;
  settings: Record<string, string>;
  profile_events: Record<string, number>;
  used_functions: string[];
  used_storages: string[];
  used_aggregate_functions: string[];
}

export interface QueryListResponse {
  queries: QueryLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface MetricPoint {
  event_time: string;
  memory_usage: number;
  peak_memory_usage: number;
  user_time_microseconds: number;
  system_time_microseconds: number;
  disk_read_elapsed_microseconds: number;
  disk_write_elapsed_microseconds: number;
  network_receive_elapsed_microseconds: number;
  network_send_elapsed_microseconds: number;
  read_bytes: number;
  write_bytes: number;
  network_receive_bytes: number;
  network_send_bytes: number;
  read_rows: number;
  thread_count: number;
}

export interface ThreadEntry {
  event_time: string;
  query_duration_ms: number;
  thread_name: string;
  thread_id: number;
  master_thread_id: number;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  memory_usage: number;
  peak_memory_usage: number;
  profile_events: Record<string, number>;
}

export interface TraceEntry {
  event_time: string;
  trace_type: string;
  thread_id: number;
  thread_name: string;
  trace: number[];
  symbols: string[];
  lines: string[];
  size: number;
}

export interface ViewLogEntry {
  event_time: string;
  view_duration_ms: number;
  view_name: string;
  view_type: string;
  view_query: string;
  view_target: string;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  peak_memory_usage: number;
  status: string;
  exception_code: number;
  exception: string;
  profile_events: Record<string, number>;
}

export interface ExplainResult {
  plan?: string;
  pipeline?: string;
  syntax?: string;
}

export interface FlameGraphData {
  name: string;
  value: number;
}

export interface ThreadSummary {
  thread_id: number;
  thread_name: string;
  role: string;
  peak_memory_usage: number;
  current_memory: number;
  read_rows: number;
  read_bytes: number;
  query_duration_ms: number;
  user_time_us: number;
  system_time_us: number;
  real_time_us: number;
  disk_read_us: number;
  filter_total_rows: number;
  filter_passed_rows: number;
  profile_events: Record<string, number>;
}

export interface TopFunction {
  name: string;
  samples: number;
  percent: number;
}

export interface ThreadProfile {
  thread_id: number;
  thread_name: string;
  role: string;
  peak_memory_usage: number;
  current_memory: number;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  duration_ms: number;
  profile_events: Record<string, number>;
  top_functions: TopFunction[];
  total_samples: number;
}

export interface QueryListParams {
  from_time?: string;
  to_time?: string;
  user?: string;
  query_kind?: string;
  min_duration?: number;
  min_memory?: number;
  min_read_bytes?: number;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
  offset?: number;
  hide_system_queries?: boolean;
}

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  row_count: number;
  timing_ms: number;
  query_id: string;
}

export interface OptColumn {
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
  is_in_partition_key: boolean;
  is_in_order_by_key: boolean;
  is_in_primary_key: boolean;
  distinct_count?: number;
  total_sampled?: number;
  null_count?: number;
  min_value?: string;
  max_value?: string;
  avg_diff?: number;
}

export interface PartInfo {
  partition: string;
  parts_count: number;
  rows: number;
  bytes_on_disk: number;
}

export interface IndexInfo {
  name: string;
  type: string;
  expr: string;
  granularity: number;
}

export interface Recommendation {
  category: string;
  severity: string;
  confidence: string;
  title: string;
  description: string;
  current?: string;
  suggested?: string;
  impact?: string;
  ddl?: string;
  requires_recreate: boolean;
}

export interface TableAnalysis {
  database: string;
  table: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
  partition_key: string;
  order_by_key: string;
  primary_key: string;
  sampling_key: string;
  columns: OptColumn[];
  parts: PartInfo[];
  existing_indices: IndexInfo[];
  recommendations: Recommendation[];
  analyzed_at: string;
  error?: string;
}

export interface BulkProgress {
  current: number;
  total: number;
  database: string;
  table: string;
}

export interface BulkDone {
  analyzed: number;
  skipped: number;
  errors: number;
}

export interface BulkEvent {
  type: "progress" | "result" | "done";
  progress?: BulkProgress;
  result?: TableAnalysis;
  done?: BulkDone;
}

export interface ProcessEntry {
  query_id: string;
  query: string;
  user: string;
  query_duration_ms: number;
  memory_usage: number;
  peak_memory_usage: number;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  peak_threads_usage: number;
  current_database: string;
  is_initial_query: number;
  initial_query_id: string;
}

export interface QueryFingerprint {
  normalized_query_hash: string;
  sample_query: string;
  query_kind: string;
  execution_count: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  max_duration_ms: number;
  avg_memory_usage: number;
  max_memory_usage: number;
  avg_read_rows: number;
  max_read_rows: number;
  avg_read_bytes: number;
  max_read_bytes: number;
  error_count: number;
  last_error: string;
  last_seen: string;
  users: string[];
}

export interface FingerprintListResponse {
  fingerprints: QueryFingerprint[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardData {
  metrics: { metric: string; value: number }[];
  recent_events: { event: string; host: string; value: number }[];
  database_sizes: { database: string; tables: number; rows: number; compressed_bytes: number; uncompressed_bytes: number }[];
  top_tables_by_size: { database: string; table: string; parts: number; rows: number; compressed_bytes: number; uncompressed_bytes: number }[];
  top_tables_by_parts: { database: string; table: string; parts: number; rows: number; compressed_bytes: number; uncompressed_bytes: number }[];
  replication_queue: { database: string; table: string; replica_name: string; position: number; type: string; create_time: string; is_started: number; num_tries: number; last_exception: string }[];
  replica_statuses: { database: string; table: string; replica_name: string; is_leader: number; is_readonly: number; absolute_delay: number; queue_size: number; inserts_in_queue: number; merges_in_queue: number; log_max_index: number; log_pointer: number; total_replicas: number; active_replicas: number }[];
  nodes: { host: string; uptime: number; version: string }[];
}

export interface FingerprintQuery {
  query_id: string;
  event_time: string;
  query_duration_ms: number;
  memory_usage: number;
  read_rows: number;
  read_bytes: number;
  result_rows: number;
  peak_threads_usage: number;
  user: string;
  type: string;
  exception: string;
}

export interface FingerprintQueriesResponse {
  queries: FingerprintQuery[];
  total: number;
}

export interface TrendPoint {
  bucket: string;
  execution_count: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  max_duration_ms: number;
  avg_memory_usage: number;
  max_memory_usage: number;
  avg_read_rows: number;
  max_read_rows: number;
  avg_read_bytes: number;
  max_read_bytes: number;
  avg_result_rows: number;
  max_result_rows: number;
  avg_peak_threads: number;
  max_peak_threads: number;
  error_count: number;
}


