package clickhouse

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

type QueryLogEntry struct {
	Type                   string            `json:"type"`
	EventTime              time.Time         `json:"event_time"`
	QueryStartTime         time.Time         `json:"query_start_time"`
	QueryDurationMs        uint64            `json:"query_duration_ms"`
	QueryID                string            `json:"query_id"`
	Query                  string            `json:"query"`
	NormalizedQueryHash    string            `json:"normalized_query_hash"`
	QueryKind              string            `json:"query_kind"`
	User                   string            `json:"user"`
	ReadRows               uint64            `json:"read_rows"`
	ReadBytes              uint64            `json:"read_bytes"`
	WrittenRows            uint64            `json:"written_rows"`
	WrittenBytes           uint64            `json:"written_bytes"`
	ResultRows             uint64            `json:"result_rows"`
	ResultBytes            uint64            `json:"result_bytes"`
	MemoryUsage            uint64            `json:"memory_usage"`
	PeakThreadsUsage       uint64            `json:"peak_threads_usage"`
	ExceptionCode          int32             `json:"exception_code"`
	Exception              string            `json:"exception"`
	Databases              []string          `json:"databases"`
	Tables                 []string          `json:"tables"`
	IsInitialQuery         uint8             `json:"is_initial_query"`
	InitialQueryID         string            `json:"initial_query_id"`
	Settings               map[string]string `json:"settings"`
	ProfileEvents          map[string]uint64 `json:"profile_events"`
	UsedFunctions          []string          `json:"used_functions"`
	UsedStorages           []string          `json:"used_storages"`
	UsedAggregateFunctions []string          `json:"used_aggregate_functions"`
}

type QueryListParams struct {
	FromTime          string `json:"from_time"`
	ToTime            string `json:"to_time"`
	User              string `json:"user"`
	Database          string `json:"database"`
	Table             string `json:"table"`
	QueryKind         string `json:"query_kind"`
	MinDuration       uint64 `json:"min_duration"`
	MinMemory         uint64 `json:"min_memory"`
	MinReadBytes      uint64 `json:"min_read_bytes"`
	ErrorsOnly        bool   `json:"errors_only"`
	LogComment        string `json:"log_comment"`
	Search            string `json:"search"`
	SortBy            string `json:"sort_by"`
	SortDir           string `json:"sort_dir"`
	Limit             int    `json:"limit"`
	Offset            int    `json:"offset"`
	HideSystemQueries bool   `json:"hide_system_queries"`
	IncludeCount      bool   `json:"include_count"`
}

var defaultListParams = QueryListParams{
	Limit:   50,
	Offset:  0,
	SortBy:  "query_start_time",
	SortDir: "DESC",
}

// hideSystemQueriesClause returns the SQL fragment used to suppress
// ClickLens-issued queries when "Hide internal queries" is enabled.
// "Internal" means only queries ClickLens itself issued, tagged via the
// log_comment setting. We deliberately do NOT exclude by query_kind — that
// hid user-issued DDL (e.g. dbt CREATE/DROP/ALTER) which is real workload.
//
// Notably it does NOT exclude queries merely for touching the system database,
// so a user's own SELECT ... FROM system.* queries remain visible.
func hideSystemQueriesClause() string {
	return "log_comment != '" + managedLogComment + "'"
}

// minUserQueryLogVersion is the ClickHouse release that added
// system.user_query_log (26.8): a per-user view of query history for users
// without access to the full system.query_log.
const minUserQueryLogVersion = "26.8"

// queryLogRef returns the table to read for query history. After an
// ACCESS_DENIED flip (see tryUserQueryLogFallback) reads go to
// system.user_query_log instead — node-local, never cluster-wide.
func (c *Client) queryLogRef() string {
	if c.queryLogFallback.Load() {
		return "system.user_query_log"
	}
	return c.tableRef("query_log")
}

// UsingUserQueryLog reports whether query-history reads are limited to the
// connecting user's own queries (so the UI can badge it).
func (c *Client) UsingUserQueryLog() bool { return c.queryLogFallback.Load() }

// tryUserQueryLogFallback reacts to an ACCESS_DENIED error reading
// system.query_log: probes system.user_query_log once and, when it works,
// switches all query-history reads to it. Returns true when the caller
// should retry with queryLogRef().
func (c *Client) tryUserQueryLogFallback(ctx context.Context, err error) bool {
	if c.queryLogFallback.Load() {
		return false
	}
	chErr, _ := Classify(err)
	if chErr == nil || chErr.Code != CHAccessDenied {
		return false
	}
	if !c.queryLogDenied.CompareAndSwap(false, true) {
		return false
	}
	if c.Version() != "" && compareVersions(c.Version(), minUserQueryLogVersion) < 0 {
		return false
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var one uint8
	if perr := c.conn.QueryRow(probeCtx, "SELECT 1 FROM system.user_query_log LIMIT 1").Scan(&one); perr != nil {
		return false
	}
	c.queryLogFallback.Store(true)
	return true
}

// queryLogFilter accumulates the bound-argument WHERE/PREWHERE fragments
// shared by every query-history surface (ListQueries, ListFingerprints).
// Keeping the builders in one place is what guarantees the surfaces apply
// the same predicates — ListFingerprints used to silently drop half the
// filters documented on QueryListParams.
type queryLogFilter struct {
	prewhereParts []string
	prewhereArgs  []any
	whereParts    []string
	whereArgs     []any
}

func (f *queryLogFilter) prewhere(cond string, args ...any) {
	f.prewhereParts = append(f.prewhereParts, cond)
	f.prewhereArgs = append(f.prewhereArgs, args...)
}

func (f *queryLogFilter) where(cond string, args ...any) {
	f.whereParts = append(f.whereParts, cond)
	f.whereArgs = append(f.whereArgs, args...)
}

func (f *queryLogFilter) prewhereClause() string {
	if len(f.prewhereParts) == 0 {
		return ""
	}
	return "PREWHERE " + strings.Join(f.prewhereParts, " AND ")
}

func (f *queryLogFilter) whereClause() string {
	return "WHERE " + strings.Join(f.whereParts, " AND ")
}

// dataArgs are the args for a query using prewhereClause() + whereClause();
// countArgs for one using countClause() (all predicates as plain WHERE).
func (f *queryLogFilter) dataArgs() []any {
	return append(append([]any{}, f.prewhereArgs...), f.whereArgs...)
}

func (f *queryLogFilter) countClause() string {
	return "WHERE " + strings.Join(append(append([]string{}, f.prewhereParts...), f.whereParts...), " AND ")
}

func (f *queryLogFilter) countArgs() []any {
	return f.dataArgs()
}

// buildQueryLogFilters turns user-facing params into SQL predicates. The
// base predicates apply to every surface:
//   - terminal rows only (running queries come from system.processes);
//   - not the health probe (`SELECT 1`);
//   - is_initial_query = 1 — on clusterAllReplicas reads every distributed
//     query contributes one terminal row per node, which would inflate
//     fingerprint counts/percentiles several-fold.
func buildQueryLogFilters(params QueryListParams) *queryLogFilter {
	f := &queryLogFilter{}
	// PREWHERE: selective filters on cheap columns (date range + search).
	// ClickHouse reads only these columns first, then the expensive ones
	// (Settings, ProfileEvents, …) for surviving rows.
	if params.FromTime != "" {
		f.prewhere("event_time >= ?", params.FromTime)
	}
	if params.ToTime != "" {
		f.prewhere("event_time <= ?", params.ToTime)
	}
	if params.Search != "" {
		f.prewhere("query ILIKE ?", "%"+params.Search+"%")
	}

	// WHERE: base predicates, then the optional filters.
	f.where("query != 'SELECT 1'")
	f.where("type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')")
	f.where("is_initial_query = 1")
	if params.HideSystemQueries {
		f.where(hideSystemQueriesClause())
	}
	if params.User != "" {
		f.where("user = ?", params.User)
	}
	if params.Database != "" {
		f.where("has(databases, ?)", params.Database)
	}
	if params.Table != "" {
		f.where("has(tables, ?)", params.Table)
	}
	if params.QueryKind != "" {
		f.where("query_kind = ?", params.QueryKind)
	}
	if params.MinDuration > 0 {
		f.where("query_duration_ms >= ?", params.MinDuration)
	}
	if params.MinMemory > 0 {
		f.where("memory_usage >= ?", params.MinMemory)
	}
	if params.MinReadBytes > 0 {
		f.where("read_bytes >= ?", params.MinReadBytes)
	}
	if params.ErrorsOnly {
		f.where("exception_code != 0")
	}
	if params.LogComment != "" {
		f.where("log_comment ILIKE ?", params.LogComment)
	}
	return f
}

func (c *Client) ListQueries(ctx context.Context, params QueryListParams) ([]QueryLogEntry, uint64, error) {
	entries, total, err := c.listQueriesWithTable(ctx, params, c.queryLogRef())
	if err != nil {
		if c.tryUserQueryLogFallback(ctx, err) {
			return c.listQueriesWithTable(ctx, params, c.queryLogRef())
		}
		return nil, 0, err
	}
	return entries, total, nil
}

func (c *Client) listQueriesWithTable(ctx context.Context, params QueryListParams, table string) ([]QueryLogEntry, uint64, error) {
	if params.Limit <= 0 {
		params.Limit = defaultListParams.Limit
	}
	if params.Limit > 500 {
		params.Limit = 500
	}
	if params.Offset < 0 {
		params.Offset = 0
	}
	if params.SortBy == "" {
		params.SortBy = defaultListParams.SortBy
	}
	if params.SortDir == "" {
		params.SortDir = defaultListParams.SortDir
	}

	// PREWHERE: selective filters on cheap columns (date range + search).
	// ClickHouse reads only these columns first, then reads expensive columns
	// (Settings, ProfileEvents, etc.) only for surviving rows.
	f := buildQueryLogFilters(params)

	allowedSorts := map[string]bool{
		"event_time": true, "query_start_time": true, "query_duration_ms": true,
		"memory_usage": true, "read_rows": true, "read_bytes": true,
		"result_rows": true, "user": true,
	}
	sortCol := "event_time"
	if allowedSorts[params.SortBy] {
		sortCol = params.SortBy
	}
	sortDir := "DESC"
	if params.SortDir == "ASC" {
		sortDir = "ASC"
	}

	// Combined WHERE clause for count() (all conditions, no PREWHERE needed
	// since count() only reads filtered columns, not expensive Maps).
	var total uint64
	if params.IncludeCount {
		countQuery := fmt.Sprintf("SELECT count() FROM %s %s", table, f.countClause())
		if err := c.conn.QueryRow(ctx, countQuery, f.countArgs()...).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("counting queries: %w", err)
		}
	}

	// Data query: PREWHERE (selective) + WHERE (rest) for column-read efficiency.
	dataQuery := fmt.Sprintf(`SELECT
		type, event_time, query_start_time, query_duration_ms, query_id, query,
		normalized_query_hash, query_kind, user,
		read_rows, read_bytes, written_rows, written_bytes, result_rows, result_bytes,
		memory_usage, peak_threads_usage, exception_code, exception,
		databases, tables, is_initial_query, initial_query_id,
		COALESCE(Settings, map('','')), COALESCE(ProfileEvents, map('','')),
		used_functions, used_storages, used_aggregate_functions
	FROM %s %s %s ORDER BY %s %s, query_id LIMIT %d OFFSET %d`, table, f.prewhereClause(), f.whereClause(), sortCol, sortDir, params.Limit, params.Offset)

	rows, err := c.conn.Query(ctx, dataQuery, f.dataArgs()...)
	if err != nil {
		return nil, 0, fmt.Errorf("querying query_log: %w", err)
	}
	defer rows.Close()

	var entries []QueryLogEntry
	for rows.Next() {
		var e QueryLogEntry
		if err := scanQueryLogEntry(rows, &e); err != nil {
			return nil, 0, fmt.Errorf("scanning query_log row: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterating query_log rows: %w", err)
	}

	return entries, total, nil
}

func (c *Client) GetQuery(ctx context.Context, queryID string) (*QueryLogEntry, error) {
	// Retry loop: after a query finishes there is a window (up to
	// flush_interval_milliseconds, ~7.5s default) where the row has left
	// system.processes but hasn't been flushed to query_log yet. In that gap
	// neither source has the row. We retry once after 2s — by then the flush
	// has usually landed. The common cases (still running → processes, or
	// already flushed → query_log) return immediately on the first attempt.
	for attempt := 0; attempt < 2; attempt++ {
		entry, retryable, err := c.getQueryOnce(ctx, queryID)
		if err == nil {
			return entry, nil
		}
		if !retryable || attempt == 1 {
			return nil, err
		}
		select {
		case <-time.After(2 * time.Second):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return nil, NotFoundErrorf("query %s", queryID)
}

// getQueryOnce is a single attempt: terminal query_log → system.processes
// fallback. Returns (nil, true, err) when neither source has the row and a
// retry might help (the race window).
func (c *Client) getQueryOnce(ctx context.Context, queryID string) (*QueryLogEntry, bool, error) {
	table := c.queryLogRef()
	query := fmt.Sprintf(`SELECT
		type, event_time, query_start_time, query_duration_ms, query_id, query,
		normalized_query_hash, query_kind, user,
		read_rows, read_bytes, written_rows, written_bytes, result_rows, result_bytes,
		memory_usage, peak_threads_usage, exception_code, exception,
		databases, tables, is_initial_query, initial_query_id,
		COALESCE(Settings, map('','')), COALESCE(ProfileEvents, map('','')),
		used_functions, used_storages, used_aggregate_functions
	FROM %s
	WHERE query_id = ? AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
	ORDER BY event_time DESC LIMIT 1`, table)

	var e QueryLogEntry
	var hash uint64
	if err := c.conn.QueryRow(ctx, query, queryID).Scan(
		&e.Type, &e.EventTime, &e.QueryStartTime, &e.QueryDurationMs,
		&e.QueryID, &e.Query, &hash, &e.QueryKind, &e.User,
		&e.ReadRows, &e.ReadBytes, &e.WrittenRows, &e.WrittenBytes,
		&e.ResultRows, &e.ResultBytes, &e.MemoryUsage, &e.PeakThreadsUsage,
		&e.ExceptionCode, &e.Exception, &e.Databases, &e.Tables,
		&e.IsInitialQuery, &e.InitialQueryID, &e.Settings, &e.ProfileEvents,
		&e.UsedFunctions, &e.UsedStorages, &e.UsedAggregateFunctions,
	); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, false, fmt.Errorf("querying query_log for %s: %w", queryID, err)
		}
		// No terminal query_log row yet. Try system.processes (still running).
		proc, perr := c.GetProcess(ctx, queryID)
		if perr != nil {
			if errors.Is(perr, ErrNotFound) {
				// Neither source has the row — likely the race window (query
				// just finished, query_log flush pending). Signal retryable.
				return nil, true, NotFoundErrorf("query %s", queryID)
			}
			return nil, false, perr
		}
		return processToEntry(proc), false, nil
	}
	e.NormalizedQueryHash = strconv.FormatUint(hash, 10)
	return &e, false, nil
}

// processToEntry synthesizes a QueryLogEntry from a live system.processes row,
// used when a query is still running and has no terminal query_log row. Type is
// set to "QueryStart" so the frontend renders its "Running" status; fields not
// available live (ProfileEvents, Settings, result counts, exception) are left
// empty and populate from query_log once the query finishes. MemoryUsage maps
// from the process peak (query_log.memory_usage is peak, and the UI labels this
// column "Peak Memory").
func processToEntry(p *ProcessEntry) *QueryLogEntry {
	var peak uint64
	if p.PeakMemory > 0 {
		peak = uint64(p.PeakMemory)
	}
	return &QueryLogEntry{
		Type:                "QueryStart",
		EventTime:           p.QueryStartTime,
		QueryStartTime:      p.QueryStartTime,
		QueryDurationMs:     uint64(p.DurationMs),
		QueryID:             p.QueryID,
		Query:               p.Query,
		NormalizedQueryHash: p.NormalizedQueryHash,
		QueryKind:           p.QueryKind,
		User:                p.User,
		ReadRows:            p.ReadRows,
		ReadBytes:           p.ReadBytes,
		WrittenRows:         p.WrittenRows,
		WrittenBytes:        p.WrittenBytes,
		MemoryUsage:         peak,
		PeakThreadsUsage:    p.ThreadCount,
		IsInitialQuery:      p.IsInitialQuery,
		InitialQueryID:      p.InitialQueryID,
		// Live processes expose no terminal-only aggregates; mirror the empty
		// shape of a finished row so the frontend never sees null slices/maps.
		Databases:              []string{},
		Tables:                 []string{},
		Settings:               map[string]string{},
		ProfileEvents:          map[string]uint64{},
		UsedFunctions:          []string{},
		UsedStorages:           []string{},
		UsedAggregateFunctions: []string{},
	}
}

type QueryFingerprint struct {
	NormalizedQueryHash string    `json:"normalized_query_hash"`
	SampleQuery         string    `json:"sample_query"`
	QueryKind           string    `json:"query_kind"`
	ExecutionCount      uint64    `json:"execution_count"`
	AvgDurationMs       float64   `json:"avg_duration_ms"`
	P50DurationMs       float64   `json:"p50_duration_ms"`
	P95DurationMs       float64   `json:"p95_duration_ms"`
	MaxDurationMs       uint64    `json:"max_duration_ms"`
	AvgMemoryUsage      float64   `json:"avg_memory_usage"`
	MaxMemoryUsage      uint64    `json:"max_memory_usage"`
	AvgReadRows         float64   `json:"avg_read_rows"`
	MaxReadRows         uint64    `json:"max_read_rows"`
	AvgReadBytes        float64   `json:"avg_read_bytes"`
	MaxReadBytes        uint64    `json:"max_read_bytes"`
	ErrorCount          uint64    `json:"error_count"`
	LastError           string    `json:"last_error"`
	LastSeen            time.Time `json:"last_seen"`
	Users               []string  `json:"users"`
}

func (c *Client) ListFingerprints(ctx context.Context, params QueryListParams) ([]QueryFingerprint, uint64, error) {
	if params.Limit <= 0 {
		params.Limit = 50
	}
	if params.Limit > 500 {
		params.Limit = 500
	}
	if params.Offset < 0 {
		params.Offset = 0
	}

	table := c.queryLogRef()

	// Same filter set as ListQueries (shared builder — this function used to
	// silently drop the database/table/min_*/errors_only filters).
	f := buildQueryLogFilters(params)

	sortBy := "last_seen"
	sortDir := "DESC"
	switch params.SortBy {
	case "execution_count", "avg_duration_ms", "p95_duration_ms", "max_duration_ms", "avg_memory_usage", "max_memory_usage", "error_count", "avg_read_rows":
		sortBy = params.SortBy
	}
	if params.SortDir == "ASC" || params.SortDir == "asc" {
		sortDir = "ASC"
	}

	var total uint64
	if params.IncludeCount {
		countQuery := fmt.Sprintf(`SELECT count() FROM (SELECT normalized_query_hash FROM %s %s GROUP BY normalized_query_hash)`, table, f.countClause())
		if err := c.conn.QueryRow(ctx, countQuery, f.countArgs()...).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("counting fingerprints: %w", err)
		}
	}

	dataArgs := append(f.dataArgs(), params.Limit, params.Offset)

	query := fmt.Sprintf(`SELECT
		normalized_query_hash,
		any(query) AS sample_query,
		any(query_kind) AS query_kind_val,
		count() AS execution_count,
		avg(query_duration_ms) AS avg_duration_ms,
		quantile(0.5)(query_duration_ms) AS p50_duration_ms,
		quantile(0.95)(query_duration_ms) AS p95_duration_ms,
		max(query_duration_ms) AS max_duration_ms,
		avg(memory_usage) AS avg_memory_usage,
		max(memory_usage) AS max_memory_usage,
		avg(read_rows) AS avg_read_rows,
		max(read_rows) AS max_read_rows,
		avg(read_bytes) AS avg_read_bytes,
		max(read_bytes) AS max_read_bytes,
		countIf(type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')) AS error_count,
		anyLastIf(exception, type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')) AS last_error,
		max(event_time) AS last_seen,
		groupUniqArray(10)(user) AS users
	FROM %s %s %s
	GROUP BY normalized_query_hash
	ORDER BY %s %s
	LIMIT ? OFFSET ?`, table, f.prewhereClause(), f.whereClause(), sortBy, sortDir)

	rows, err := c.conn.Query(ctx, query, dataArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("querying fingerprints: %w", err)
	}
	defer rows.Close()

	var fingerprints []QueryFingerprint
	for rows.Next() {
		var f QueryFingerprint
		var hash uint64
		if err := rows.Scan(
			&hash, &f.SampleQuery, &f.QueryKind,
			&f.ExecutionCount,
			&f.AvgDurationMs, &f.P50DurationMs, &f.P95DurationMs, &f.MaxDurationMs,
			&f.AvgMemoryUsage, &f.MaxMemoryUsage,
			&f.AvgReadRows, &f.MaxReadRows,
			&f.AvgReadBytes, &f.MaxReadBytes,
			&f.ErrorCount,
			&f.LastError,
			&f.LastSeen,
			&f.Users,
		); err != nil {
			return nil, 0, fmt.Errorf("scanning fingerprint: %w", err)
		}
		f.NormalizedQueryHash = strconv.FormatUint(hash, 10)
		fingerprints = append(fingerprints, f)
	}
	if fingerprints == nil {
		fingerprints = []QueryFingerprint{}
	}
	return fingerprints, total, nil
}

type FingerprintQuery struct {
	QueryID         string    `json:"query_id"`
	EventTime       time.Time `json:"event_time"`
	QueryDurationMs uint64    `json:"query_duration_ms"`
	MemoryUsage     uint64    `json:"memory_usage"`
	ReadRows        uint64    `json:"read_rows"`
	ReadBytes       uint64    `json:"read_bytes"`
	ResultRows      uint64    `json:"result_rows"`
	PeakThreads     uint64    `json:"peak_threads_usage"`
	User            string    `json:"user"`
	Type            string    `json:"type"`
	Exception       string    `json:"exception"`
}

// ListFingerprintQueries drills into one fingerprint. hideSystemQueries
// mirrors the parent list so a hidden fingerprint can't resurface here, and
// is_initial_query = 1 keeps cluster fan-out from double-counting rows.
func (c *Client) ListFingerprintQueries(ctx context.Context, hash uint64, limit int, offset int, hideSystemQueries bool) ([]FingerprintQuery, uint64, error) {
	table := c.queryLogRef()

	if limit <= 0 {
		limit = 20
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}

	base := "type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')"
	if hideSystemQueries {
		base += " AND " + hideSystemQueriesClause()
	}
	base += " AND is_initial_query = 1"

	var total uint64
	countQuery := fmt.Sprintf(`SELECT count() FROM %s WHERE normalized_query_hash = ? AND %s`, table, base)
	if err := c.conn.QueryRow(ctx, countQuery, hash).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting fingerprint queries: %w", err)
	}

	query := fmt.Sprintf(`SELECT
		query_id, event_time, query_duration_ms, memory_usage,
		read_rows, read_bytes, result_rows, peak_threads_usage,
		user, type, exception
	FROM %s
	WHERE normalized_query_hash = ? AND %s
	ORDER BY event_time DESC
	LIMIT ? OFFSET ?`, table, base)

	rows, err := c.conn.Query(ctx, query, hash, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("querying fingerprint queries: %w", err)
	}
	defer rows.Close()

	var queries []FingerprintQuery
	for rows.Next() {
		var q FingerprintQuery
		if err := rows.Scan(
			&q.QueryID, &q.EventTime, &q.QueryDurationMs, &q.MemoryUsage,
			&q.ReadRows, &q.ReadBytes, &q.ResultRows, &q.PeakThreads,
			&q.User, &q.Type, &q.Exception,
		); err != nil {
			return nil, 0, fmt.Errorf("scanning fingerprint query: %w", err)
		}
		queries = append(queries, q)
	}
	if queries == nil {
		queries = []FingerprintQuery{}
	}
	return queries, total, nil
}

func scanQueryLogEntry(rows driver.Rows, e *QueryLogEntry) error {
	var hash uint64
	err := rows.Scan(
		&e.Type, &e.EventTime, &e.QueryStartTime, &e.QueryDurationMs,
		&e.QueryID, &e.Query, &hash, &e.QueryKind, &e.User,
		&e.ReadRows, &e.ReadBytes, &e.WrittenRows, &e.WrittenBytes,
		&e.ResultRows, &e.ResultBytes, &e.MemoryUsage, &e.PeakThreadsUsage,
		&e.ExceptionCode, &e.Exception, &e.Databases, &e.Tables,
		&e.IsInitialQuery, &e.InitialQueryID, &e.Settings, &e.ProfileEvents,
		&e.UsedFunctions, &e.UsedStorages, &e.UsedAggregateFunctions,
	)
	if err != nil {
		return err
	}
	e.NormalizedQueryHash = strconv.FormatUint(hash, 10)
	return nil
}
