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

export interface ExplainEstimate {
  rows: number;
  blocks: number;
  bytes: number;
  parts: number;
  marks: number;
  raw?: string;
}

export interface ExplainResult {
  plan?: string;
  pipeline?: string;
  pipeline_graph?: string;
  syntax?: string;
  estimate?: ExplainEstimate;
  errors?: Record<string, string>;
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
  database?: string;
  table?: string;
  query_kind?: string;
  min_duration?: number;
  min_memory?: number;
  min_read_bytes?: number;
  errors_only?: boolean;
  log_comment?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
  limit?: number;
  offset?: number;
  hide_system_queries?: boolean;
  include_count?: boolean;
  no_clamp?: boolean;
}

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  row_count: number;
  total_rows: number;
  timing_ms: number;
  query_id: string;
  /** When true, the query had a FORMAT clause and `output` is its raw text. */
  is_text?: boolean;
  output?: string;
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
  query_start_time: string;
  memory_usage: number;
  peak_memory_usage: number;
  read_rows: number;
  read_bytes: number;
  written_rows: number;
  written_bytes: number;
  peak_threads_usage: number;
  normalized_query_hash: string;
  query_kind: string;
  current_database: string;
  log_comment: string;
  is_initial_query: number;
  initial_query_id: string;
}

export interface MutationDetail {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  age_seconds: number;
  parts_to_do: number;
  is_done: number;
  is_killed: number;
  latest_failed_part: string;
  latest_fail_time: string;
  latest_fail_reason: string;
  latest_fail_error_code_name: string;
}

export interface MergeDetail {
  database: string;
  table: string;
  elapsed: number;
  progress: number;
  num_parts: number;
  result_part_name: string;
  total_size_bytes_compressed: number;
  rows_read: number;
  memory_usage: number;
  merge_type: string;
  merge_algorithm: string;
  is_mutation: number;
}

export interface UserRow {
  name: string;
  storage: string;
  auth_type: string[] | null;
  default_roles: string[] | null;
  default_database: string;
}

export interface RoleRow {
  name: string;
  storage: string;
}

export interface RoleGrant {
  user_name: string;
  granted_role_name: string;
  granted_role_is_default: number;
  with_admin_option: number;
}

export interface GrantRow {
  user_name: string;
  role_name: string;
  access_type: string;
  database: string;
  table: string;
  column: string;
  is_partial_revoke: number;
  grant_option: number;
}

export interface QuotaUsageRow {
  quota_name: string;
  quota_key: string;
  start_time: string;
  end_time: string;
  duration: number;
  queries: number;
  max_queries: number;
  errors: number;
  result_rows: number;
  result_bytes: number;
  read_rows: number;
  read_bytes: number;
  execution_time: number;
}

export interface QuotaDef {
  name: string;
  keys: string;
  durations: number[];
  apply_to_all: number;
  apply_to_list: string[] | null;
  apply_to_except: string[] | null;
}

export interface AccessOverview {
  current_user: string;
  can_manage_access: boolean;
  users: UserRow[];
  roles: RoleRow[];
  grants: GrantRow[];
  role_grants: RoleGrant[];
  quotas: QuotaDef[];
  quota_usage: QuotaUsageRow[];
  partial_errors: string[];
  partial_error_details?: Record<string, string>;
}

export interface AsyncMetric {
  host: string;
  metric: string;
  value: number;
  description: string;
}

export interface QueryHealthPoint {
  bucket: string;
  count: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  avg_memory: number;
  errors: number;
}

export interface AsyncMetricsOverview {
  is_cluster: boolean;
  cluster: string;
  hosts: string[];
  metrics: AsyncMetric[];
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
  metrics: { metric: string; host: string; value: number }[];
  recent_events: { event: string; host: string; value: number }[];
  database_sizes: { database: string; tables: number; rows: number; compressed_bytes: number; uncompressed_bytes: number }[];
  top_tables_by_size: { database: string; table: string; parts: number; rows: number; compressed_bytes: number; uncompressed_bytes: number }[];
  top_tables_by_parts: { database: string; table: string; parts: number; max_parts_in_partition: number; rows: number; compressed_bytes: number; uncompressed_bytes: number }[];
  replication_queue: { database: string; table: string; replica_name: string; position: number; type: string; create_time: string; is_started: number; num_tries: number; last_exception: string }[];
  replica_statuses: { database: string; table: string; replica_name: string; is_leader: number; is_readonly: number; absolute_delay: number; queue_size: number; inserts_in_queue: number; merges_in_queue: number; log_max_index: number; log_pointer: number; total_replicas: number; active_replicas: number }[];
  nodes: { host: string; uptime: number; version: string }[];
  log_tables: { table: string; rows: number; compressed_bytes: number; uncompressed_bytes: number; exists: boolean; enabled: boolean }[];
  settings: { name: string; value: string }[];
  warnings: string[];
  cluster: string;
  is_cluster: boolean;
  cluster_note?: string;
  database: string;
  user: string;
  host_name: string;
  partial_errors: string[];
  partial_error_details?: Record<string, string>;
  parts_to_delay_insert: number;
  parts_to_throw_insert: number;
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

export interface ReplicaStatus {
  database: string;
  table: string;
  replica_name: string;
  is_leader: number;
  is_readonly: number;
  absolute_delay: number;
  queue_size: number;
  inserts_in_queue: number;
  merges_in_queue: number;
  log_max_index: number;
  log_pointer: number;
  total_replicas: number;
  active_replicas: number;
  queue_oldest_time: string;
  is_session_expired: number;
}

export interface ReplicationQueueEntry {
  database: string;
  table: string;
  replica_name: string;
  position: number;
  type: string;
  create_time: string;
  is_currently_executing: number;
  num_tries: number;
  last_exception: string;
  num_postponed: number;
  postpone_reason: string;
  source_replica: string;
}

export interface MutationEntry {
  database: string;
  table: string;
  mutation_id: string;
  command: string;
  create_time: string;
  parts_to_do: number;
  is_done: number;
  latest_failed_part: string;
  latest_fail_reason: string;
}

export interface KeeperStatus {
  port: number;
  session_uptime_seconds: number;
  is_expired: number;
  connected_time: string;
}

export interface ReplicationMetricPoint {
  event_time: string;
  readonly_replica: number;
  replicated_fetch: number;
  replicated_send: number;
  replicated_checks: number;
  zk_session: number;
  zk_session_expired: number;
}

export interface ReplicationSummary {
  total_queue_depth: number;
  max_absolute_delay: number;
  readonly_replicas: number;
  stuck_tasks: number;
  pending_mutations: number;
  replica_count: number;
}

export interface ReplicationStatus {
  replica_statuses: ReplicaStatus[];
  replication_queue: ReplicationQueueEntry[];
  mutations: MutationEntry[];
  keeper: KeeperStatus[];
  metric_history: ReplicationMetricPoint[];
  summary: ReplicationSummary;
  cluster_note?: string;
  partial_errors: string[];
  partial_error_details?: Record<string, string>;
}

export interface DistributedDDLEntry {
  query: string;
  initiator_host: string;
  cluster: string;
  status: string;
  exception_code: number;
  exception_text: string;
  query_create_time: string;
  query_finish_time: string;
  query_duration_ms: number;
}

export interface RecentDDLEntry {
  event_time: string;
  query_id: string;
  query_kind: string;
  query: string;
  query_duration_ms: number;
  user: string;
  exception: string;
}

export interface DDLOpsPoint {
  bucket: string;
  total: number;
  failed: number;
}

export interface DDLStatus {
  distributed_ddl: DistributedDDLEntry[];
  recent_ddl: RecentDDLEntry[];
  trend: DDLOpsPoint[];
  hours: number;
  pending_mutations: number;
  stuck_ddl: number;
  failed_ddl: number;
  cluster_note?: string;
  partial_errors: string[];
  partial_error_details?: Record<string, string>;
}


