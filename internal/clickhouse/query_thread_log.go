package clickhouse

import (
	"context"
	"fmt"
	"time"
)

type ThreadEntry struct {
	EventTime       time.Time         `json:"event_time"`
	QueryDurationMs uint64            `json:"query_duration_ms"`
	ThreadName      string            `json:"thread_name"`
	ThreadID        uint64            `json:"thread_id"`
	MasterThreadID  uint64            `json:"master_thread_id"`
	ReadRows        uint64            `json:"read_rows"`
	ReadBytes       uint64            `json:"read_bytes"`
	WrittenRows     uint64            `json:"written_rows"`
	WrittenBytes    uint64            `json:"written_bytes"`
	MemoryUsage     int64             `json:"memory_usage"`
	PeakMemoryUsage int64             `json:"peak_memory_usage"`
	ProfileEvents   map[string]uint64 `json:"profile_events"`
}

func (c *Client) GetQueryThreads(ctx context.Context, queryID string) ([]ThreadEntry, error) {
	table := c.tableRef("query_thread_log")
	query := fmt.Sprintf(`SELECT
		event_time, query_duration_ms, thread_name, thread_id, master_thread_id,
		read_rows, read_bytes, written_rows, written_bytes,
		memory_usage, peak_memory_usage, ProfileEvents
	FROM %s
	WHERE query_id = ?
	ORDER BY event_time ASC`, table)

	rows, err := c.conn.Query(ctx, query, queryID)
	if err != nil {
		return nil, fmt.Errorf("querying query_thread_log: %w", err)
	}
	defer rows.Close()

	var entries []ThreadEntry
	for rows.Next() {
		var e ThreadEntry
		if err := rows.Scan(
			&e.EventTime, &e.QueryDurationMs, &e.ThreadName, &e.ThreadID,
			&e.MasterThreadID, &e.ReadRows, &e.ReadBytes, &e.WrittenRows,
			&e.WrittenBytes, &e.MemoryUsage, &e.PeakMemoryUsage, &e.ProfileEvents,
		); err != nil {
			return nil, fmt.Errorf("scanning thread row: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, nil
}
