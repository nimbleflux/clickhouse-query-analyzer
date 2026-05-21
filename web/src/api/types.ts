export interface QueryLogEntry {
  type: string;
  event_time: string;
  query_start_time: string;
  query_duration_ms: number;
  query_id: string;
  query: string;
  normalized_query_hash: number;
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
  search?: string;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  row_count: number;
  timing_ms: number;
  query_id: string;
}

export interface SchemaInfo {
  databases: {
    name: string;
    tables: {
      name: string;
      engine: string;
      row_count: number;
      columns: { name: string; type: string }[];
    }[];
  }[];
}
