package clickhouse

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type ProcessEntry struct {
	QueryID             string    `json:"query_id"`
	Query               string    `json:"query"`
	User                string    `json:"user"`
	DurationMs          float64   `json:"query_duration_ms"`
	QueryStartTime      time.Time `json:"query_start_time"`
	MemoryUsage         int64     `json:"memory_usage"`
	PeakMemory          int64     `json:"peak_memory_usage"`
	ReadRows            uint64    `json:"read_rows"`
	ReadBytes           uint64    `json:"read_bytes"`
	WrittenRows         uint64    `json:"written_rows"`
	WrittenBytes        uint64    `json:"written_bytes"`
	ThreadCount         uint64    `json:"peak_threads_usage"`
	NormalizedQueryHash string    `json:"normalized_query_hash"`
	QueryKind           string    `json:"query_kind"`
	Database            string    `json:"current_database"`
	// LogComment is the value of the log_comment setting for this query.
	// ClickLens stamps its own queries with managedLogComment; the frontend
	// uses this (and only this) to identify internal queries.
	LogComment     string `json:"log_comment"`
	IsInitialQuery uint8  `json:"is_initial_query"`
	InitialQueryID string `json:"initial_query_id"`
}

// processColumns is the shared column list for system.processes, used by both
// ListProcesses and GetProcess so the two scans cannot drift. now()-elapsed
// derives a start time (system.processes exposes only elapsed, not a native
// start timestamp).
const processColumns = `query_id, query, user,
	elapsed * 1000 AS query_duration_ms,
	now() - elapsed AS query_start_time,
	memory_usage, peak_memory_usage,
	read_rows, read_bytes, written_rows, written_bytes,
	peak_threads_usage,
	toString(normalized_query_hash) AS normalized_query_hash,
	query_kind,
	current_database,
	log_comment,
	is_initial_query, initial_query_id`

func (p *ProcessEntry) scanTargets() []any {
	return []any{
		&p.QueryID, &p.Query, &p.User,
		&p.DurationMs, &p.QueryStartTime,
		&p.MemoryUsage, &p.PeakMemory,
		&p.ReadRows, &p.ReadBytes, &p.WrittenRows, &p.WrittenBytes,
		&p.ThreadCount,
		&p.NormalizedQueryHash, &p.QueryKind,
		&p.Database,
		&p.LogComment,
		&p.IsInitialQuery, &p.InitialQueryID,
	}
}

func (c *Client) ListProcesses(ctx context.Context) ([]ProcessEntry, error) {
	query := fmt.Sprintf("SELECT %s FROM %s ORDER BY query_duration_ms DESC", processColumns, c.tableRef("processes"))

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying processes: %w", err)
	}
	defer rows.Close()

	var processes []ProcessEntry
	for rows.Next() {
		var p ProcessEntry
		if err := rows.Scan(p.scanTargets()...); err != nil {
			return nil, fmt.Errorf("scanning process row: %w", err)
		}
		processes = append(processes, p)
	}
	if processes == nil {
		processes = []ProcessEntry{}
	}
	return processes, nil
}

// GetProcess returns the single system.processes row for queryID. Used as the
// fallback for a still-running query that has not yet been written to query_log
// (query_log rows are emitted on completion, so a live process has no terminal
// query_log row). Returns an ErrNotFound-wrapped error when no such process
// exists.
func (c *Client) GetProcess(ctx context.Context, queryID string) (*ProcessEntry, error) {
	query := fmt.Sprintf("SELECT %s FROM %s WHERE query_id = ? LIMIT 1", processColumns, c.tableRef("processes"))
	var p ProcessEntry
	if err := c.conn.QueryRow(ctx, query, queryID).Scan(p.scanTargets()...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, NotFoundErrorf("process %s", queryID)
		}
		return nil, fmt.Errorf("querying process %s: %w", queryID, err)
	}
	return &p, nil
}

func (c *Client) KillQuery(ctx context.Context, queryID string) error {
	return c.conn.Exec(ctx, "KILL QUERY WHERE query_id = ?", queryID)
}

// KillQueriesByUser kills every currently-running query issued by user and
// returns the count that were running (counted from system.processes
// immediately before the kill). A tiny race between count and kill is
// acceptable; callers refresh the process list afterwards.
func (c *Client) KillQueriesByUser(ctx context.Context, user string) (uint64, error) {
	table := c.tableRef("processes")
	var count uint64
	if err := c.conn.QueryRow(ctx, fmt.Sprintf("SELECT count() FROM %s WHERE user = ?", table), user).Scan(&count); err != nil {
		return 0, fmt.Errorf("counting processes for user %s: %w", user, err)
	}
	if err := c.conn.Exec(ctx, "KILL QUERY WHERE user = ?", user); err != nil {
		return 0, fmt.Errorf("killing queries for user %s: %w", user, err)
	}
	return count, nil
}
