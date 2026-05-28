package clickhouse

import (
	"context"
	"fmt"
	"strings"
)

type ProcessEntry struct {
	QueryID        string   `json:"query_id"`
	Query          string   `json:"query"`
	User           string   `json:"user"`
	DurationMs     float64  `json:"query_duration_ms"`
	MemoryUsage    int64    `json:"memory_usage"`
	PeakMemory     int64    `json:"peak_memory_usage"`
	ReadRows       uint64   `json:"read_rows"`
	ReadBytes      uint64   `json:"read_bytes"`
	WrittenRows    uint64   `json:"written_rows"`
	WrittenBytes   uint64   `json:"written_bytes"`
	ThreadCount    uint64   `json:"peak_threads_usage"`
	Database       string   `json:"current_database"`
	IsInitialQuery uint8    `json:"is_initial_query"`
	InitialQueryID string   `json:"initial_query_id"`
}

func (c *Client) ListProcesses(ctx context.Context) ([]ProcessEntry, error) {
	table := c.tableRef("processes")
	query := fmt.Sprintf(`SELECT
		query_id, query, user,
		elapsed * 1000 AS query_duration_ms,
		memory_usage, peak_memory_usage,
		read_rows, read_bytes, written_rows, written_bytes,
		peak_threads_usage,
		current_database,
		is_initial_query, initial_query_id
	FROM %s ORDER BY query_duration_ms DESC`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying processes: %w", err)
	}
	defer rows.Close()

	var processes []ProcessEntry
	for rows.Next() {
		var p ProcessEntry
		if err := rows.Scan(
			&p.QueryID, &p.Query, &p.User,
			&p.DurationMs,
			&p.MemoryUsage, &p.PeakMemory,
			&p.ReadRows, &p.ReadBytes, &p.WrittenRows, &p.WrittenBytes,
			&p.ThreadCount,
			&p.Database,
			&p.IsInitialQuery, &p.InitialQueryID,
		); err != nil {
			return nil, fmt.Errorf("scanning process row: %w", err)
		}
		processes = append(processes, p)
	}
	if processes == nil {
		processes = []ProcessEntry{}
	}
	return processes, nil
}

func (c *Client) KillQuery(ctx context.Context, queryID string) error {
	escaped := strings.ReplaceAll(queryID, "'", "''")
	return c.conn.Exec(ctx, fmt.Sprintf("KILL QUERY WHERE query_id = '%s'", escaped))
}
