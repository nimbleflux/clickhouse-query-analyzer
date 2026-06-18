package clickhouse

import (
	"context"
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
	QueryKind         string `json:"query_kind"`
	MinDuration       uint64 `json:"min_duration"`
	MinMemory         uint64 `json:"min_memory"`
	MinReadBytes      uint64 `json:"min_read_bytes"`
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

func (c *Client) ListQueries(ctx context.Context, params QueryListParams) ([]QueryLogEntry, uint64, error) {
	if params.Limit <= 0 {
		params.Limit = defaultListParams.Limit
	}
	if params.SortBy == "" {
		params.SortBy = defaultListParams.SortBy
	}
	if params.SortDir == "" {
		params.SortDir = defaultListParams.SortDir
	}

	table := c.tableRef("query_log")

	// PREWHERE: selective filters on cheap columns (date range + search).
	// ClickHouse reads only these columns first, then reads expensive columns
	// (Settings, ProfileEvents, etc.) only for surviving rows.
	prewhereParts := []string{}
	prewhereArgs := []interface{}{}

	if params.FromTime != "" {
		prewhereParts = append(prewhereParts, "event_time >= ?")
		prewhereArgs = append(prewhereArgs, params.FromTime)
	}
	if params.ToTime != "" {
		prewhereParts = append(prewhereParts, "event_time <= ?")
		prewhereArgs = append(prewhereArgs, params.ToTime)
	}
	if params.Search != "" {
		prewhereParts = append(prewhereParts, "query ILIKE ?")
		prewhereArgs = append(prewhereArgs, "%"+params.Search+"%")
	}

	// WHERE: remaining filters applied after PREWHERE.
	whereParts := []string{
		"type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')",
		"query != 'SELECT 1'",
		"is_initial_query = 1",
	}
	whereArgs := []interface{}{}

	if params.HideSystemQueries {
		whereParts = append(whereParts, "NOT has(databases, 'system') AND lower(query_kind) NOT IN ('explain', 'system', 'show', 'create', 'drop', 'alter', 'set', 'use', 'kill', 'optimize', 'truncate', 'rename', 'check', 'detach', 'attach', 'none')")
	}
	if params.User != "" {
		whereParts = append(whereParts, "user = ?")
		whereArgs = append(whereArgs, params.User)
	}
	if params.QueryKind != "" {
		whereParts = append(whereParts, "query_kind = ?")
		whereArgs = append(whereArgs, params.QueryKind)
	}
	if params.MinDuration > 0 {
		whereParts = append(whereParts, "query_duration_ms >= ?")
		whereArgs = append(whereArgs, params.MinDuration)
	}
	if params.MinMemory > 0 {
		whereParts = append(whereParts, "memory_usage >= ?")
		whereArgs = append(whereArgs, params.MinMemory)
	}
	if params.MinReadBytes > 0 {
		whereParts = append(whereParts, "read_bytes >= ?")
		whereArgs = append(whereArgs, params.MinReadBytes)
	}

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
	allParts := append(append([]string{}, prewhereParts...), whereParts...)
	allArgs := append(append([]interface{}{}, prewhereArgs...), whereArgs...)
	countWhere := "WHERE " + strings.Join(allParts, " AND ")

	countQuery := fmt.Sprintf("SELECT count() FROM %s %s", table, countWhere)
	var total uint64
	if params.IncludeCount {
		if err := c.conn.QueryRow(ctx, countQuery, allArgs...).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("counting queries: %w", err)
		}
	}

	// Data query: PREWHERE (selective) + WHERE (rest) for column-read efficiency.
	prewhereClause := ""
	if len(prewhereParts) > 0 {
		prewhereClause = "PREWHERE " + strings.Join(prewhereParts, " AND ")
	}
	whereClause := "WHERE " + strings.Join(whereParts, " AND ")
	dataArgs := append(prewhereArgs, whereArgs...)

	dataQuery := fmt.Sprintf(`SELECT
		type, event_time, query_start_time, query_duration_ms, query_id, query,
		normalized_query_hash, query_kind, user,
		read_rows, read_bytes, written_rows, written_bytes, result_rows, result_bytes,
		memory_usage, peak_threads_usage, exception_code, exception,
		databases, tables, is_initial_query, initial_query_id,
		COALESCE(Settings, map('','')), COALESCE(ProfileEvents, map('','')),
		used_functions, used_storages, used_aggregate_functions
	FROM %s %s %s ORDER BY %s %s, query_id LIMIT %d OFFSET %d`, table, prewhereClause, whereClause, sortCol, sortDir, params.Limit, params.Offset)

	rows, err := c.conn.Query(ctx, dataQuery, dataArgs...)
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
	table := c.tableRef("query_log")
	query := fmt.Sprintf(`SELECT
		type, event_time, query_start_time, query_duration_ms, query_id, query,
		normalized_query_hash, query_kind, user,
		read_rows, read_bytes, written_rows, written_bytes, result_rows, result_bytes,
		memory_usage, peak_threads_usage, exception_code, exception,
		databases, tables, is_initial_query, initial_query_id,
		COALESCE(Settings, map('','')), COALESCE(ProfileEvents, map('','')),
		used_functions, used_storages, used_aggregate_functions
	FROM %s WHERE query_id = ? ORDER BY event_time DESC LIMIT 1`, table)

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
		return nil, fmt.Errorf("querying query_log for %s: %w", queryID, err)
	}
	e.NormalizedQueryHash = strconv.FormatUint(hash, 10)
	return &e, nil
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
	if params.Offset < 0 {
		params.Offset = 0
	}

	table := c.tableRef("query_log")

	where := "WHERE query != 'SELECT 1' AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')"
	args := []interface{}{}

	if params.HideSystemQueries {
		where += " AND NOT has(databases, 'system') AND lower(query_kind) NOT IN ('explain', 'system', 'show', 'create', 'drop', 'alter', 'set', 'use', 'kill', 'optimize', 'truncate', 'rename', 'check', 'detach', 'attach', 'none')"
	}

	if params.FromTime != "" {
		where += " AND event_time >= ?"
		args = append(args, params.FromTime)
	}
	if params.ToTime != "" {
		where += " AND event_time <= ?"
		args = append(args, params.ToTime)
	}
	if params.User != "" {
		where += " AND user = ?"
		args = append(args, params.User)
	}
	if params.Search != "" {
		where += " AND query ILIKE ?"
		args = append(args, "%"+params.Search+"%")
	}

	sortBy := "last_seen"
	sortDir := "DESC"
	switch params.SortBy {
	case "execution_count", "avg_duration_ms", "p95_duration_ms", "max_duration_ms", "avg_memory_usage", "max_memory_usage", "error_count", "avg_read_rows":
		sortBy = params.SortBy
	}
	if params.SortDir == "ASC" || params.SortDir == "asc" {
		sortDir = "ASC"
	}

	countQuery := fmt.Sprintf(`SELECT count() FROM (SELECT normalized_query_hash FROM %s %s GROUP BY normalized_query_hash)`, table, where)
	var total uint64
	if err := c.conn.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting fingerprints: %w", err)
	}

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
	FROM %s %s
	GROUP BY normalized_query_hash
	ORDER BY %s %s
	LIMIT ? OFFSET ?`, table, where, sortBy, sortDir)
	args = append(args, params.Limit, params.Offset)

	rows, err := c.conn.Query(ctx, query, args...)
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

func (c *Client) ListFingerprintQueries(ctx context.Context, hash uint64, limit int, offset int) ([]FingerprintQuery, uint64, error) {
	table := c.tableRef("query_log")

	if limit <= 0 {
		limit = 20
	}

	var total uint64
	countQuery := fmt.Sprintf(`SELECT count() FROM %s WHERE normalized_query_hash = ? AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')`, table)
	if err := c.conn.QueryRow(ctx, countQuery, hash).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting fingerprint queries: %w", err)
	}

	query := fmt.Sprintf(`SELECT
		query_id, event_time, query_duration_ms, memory_usage,
		read_rows, read_bytes, result_rows, peak_threads_usage,
		user, type, exception
	FROM %s
	WHERE normalized_query_hash = ? AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
	ORDER BY event_time DESC
	LIMIT ? OFFSET ?`, table)

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
