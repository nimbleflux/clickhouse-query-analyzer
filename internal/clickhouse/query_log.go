package clickhouse

import (
	"context"
	"fmt"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

type QueryLogEntry struct {
	Type                      string    `json:"type"`
	EventTime                 time.Time `json:"event_time"`
	QueryStartTime            time.Time `json:"query_start_time"`
	QueryDurationMs           uint64    `json:"query_duration_ms"`
	QueryID                   string    `json:"query_id"`
	Query                     string    `json:"query"`
	NormalizedQueryHash       uint64    `json:"normalized_query_hash"`
	QueryKind                 string    `json:"query_kind"`
	User                      string    `json:"user"`
	ReadRows                  uint64    `json:"read_rows"`
	ReadBytes                 uint64    `json:"read_bytes"`
	WrittenRows               uint64    `json:"written_rows"`
	WrittenBytes              uint64    `json:"written_bytes"`
	ResultRows                uint64    `json:"result_rows"`
	ResultBytes               uint64    `json:"result_bytes"`
	MemoryUsage               uint64    `json:"memory_usage"`
	PeakThreadsUsage          uint64    `json:"peak_threads_usage"`
	ExceptionCode             int32     `json:"exception_code"`
	Exception                 string    `json:"exception"`
	Databases                 []string  `json:"databases"`
	Tables                    []string  `json:"tables"`
	IsInitialQuery            uint8     `json:"is_initial_query"`
	InitialQueryID            string    `json:"initial_query_id"`
	Settings                  map[string]string `json:"settings"`
	ProfileEvents             map[string]uint64 `json:"profile_events"`
	UsedFunctions             []string  `json:"used_functions"`
	UsedStorages              []string  `json:"used_storages"`
	UsedAggregateFunctions    []string  `json:"used_aggregate_functions"`
}

type QueryListParams struct {
	FromTime    string `json:"from_time"`
	ToTime      string `json:"to_time"`
	User        string `json:"user"`
	QueryKind   string `json:"query_kind"`
	MinDuration uint64 `json:"min_duration"`
	MinMemory   uint64 `json:"min_memory"`
	Search      string `json:"search"`
	SortBy      string `json:"sort_by"`
	SortDir     string `json:"sort_dir"`
	Limit       int    `json:"limit"`
	Offset      int    `json:"offset"`
}

var defaultListParams = QueryListParams{
	Limit:  50,
	Offset: 0,
	SortBy: "query_start_time",
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

	where := "WHERE type = 'QueryFinish' AND query != 'SELECT 1'"
	args := []interface{}{}

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
	if params.QueryKind != "" {
		where += " AND query_kind = ?"
		args = append(args, params.QueryKind)
	}
	if params.MinDuration > 0 {
		where += " AND query_duration_ms >= ?"
		args = append(args, params.MinDuration)
	}
	if params.MinMemory > 0 {
		where += " AND memory_usage >= ?"
		args = append(args, params.MinMemory)
	}
	if params.Search != "" {
		where += " AND query ILIKE ?"
		args = append(args, "%"+params.Search+"%")
	}
	where += " AND is_initial_query = 1"

	allowedSorts := map[string]bool{
		"query_start_time": true, "query_duration_ms": true,
		"memory_usage": true, "read_rows": true, "read_bytes": true,
		"result_rows": true, "user": true,
	}
	sortCol := "query_start_time"
	if allowedSorts[params.SortBy] {
		sortCol = params.SortBy
	}
	sortDir := "DESC"
	if params.SortDir == "ASC" {
		sortDir = "ASC"
	}

	countQuery := fmt.Sprintf("SELECT count() FROM %s %s", table, where)
	var total uint64
	if err := c.conn.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting queries: %w", err)
	}

	dataQuery := fmt.Sprintf(`SELECT
		type, event_time, query_start_time, query_duration_ms, query_id, query,
		normalized_query_hash, query_kind, user,
		read_rows, read_bytes, written_rows, written_bytes, result_rows, result_bytes,
		memory_usage, peak_threads_usage, exception_code, exception,
		databases, tables, is_initial_query, initial_query_id,
		Settings, ProfileEvents,
		used_functions, used_storages, used_aggregate_functions
	FROM %s %s ORDER BY %s %s LIMIT %d OFFSET %d`, table, where, sortCol, sortDir, params.Limit, params.Offset)

	rows, err := c.conn.Query(ctx, dataQuery, args...)
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
		Settings, ProfileEvents,
		used_functions, used_storages, used_aggregate_functions
	FROM %s WHERE query_id = ? AND type = 'QueryFinish' LIMIT 1`, table)

	var e QueryLogEntry
	if err := c.conn.QueryRow(ctx, query, queryID).Scan(
		&e.Type, &e.EventTime, &e.QueryStartTime, &e.QueryDurationMs,
		&e.QueryID, &e.Query, &e.NormalizedQueryHash, &e.QueryKind, &e.User,
		&e.ReadRows, &e.ReadBytes, &e.WrittenRows, &e.WrittenBytes,
		&e.ResultRows, &e.ResultBytes, &e.MemoryUsage, &e.PeakThreadsUsage,
		&e.ExceptionCode, &e.Exception, &e.Databases, &e.Tables,
		&e.IsInitialQuery, &e.InitialQueryID, &e.Settings, &e.ProfileEvents,
		&e.UsedFunctions, &e.UsedStorages, &e.UsedAggregateFunctions,
	); err != nil {
		return nil, fmt.Errorf("querying query_log for %s: %w", queryID, err)
	}
	return &e, nil
}

func scanQueryLogEntry(rows driver.Rows, e *QueryLogEntry) error {
	return rows.Scan(
		&e.Type, &e.EventTime, &e.QueryStartTime, &e.QueryDurationMs,
		&e.QueryID, &e.Query, &e.NormalizedQueryHash, &e.QueryKind, &e.User,
		&e.ReadRows, &e.ReadBytes, &e.WrittenRows, &e.WrittenBytes,
		&e.ResultRows, &e.ResultBytes, &e.MemoryUsage, &e.PeakThreadsUsage,
		&e.ExceptionCode, &e.Exception, &e.Databases, &e.Tables,
		&e.IsInitialQuery, &e.InitialQueryID, &e.Settings, &e.ProfileEvents,
		&e.UsedFunctions, &e.UsedStorages, &e.UsedAggregateFunctions,
	)
}
