package clickhouse

import (
	"context"
	"fmt"
	"time"
)

type ViewLogEntry struct {
	EventTime      time.Time         `json:"event_time"`
	ViewDurationMs uint64            `json:"view_duration_ms"`
	ViewName       string            `json:"view_name"`
	ViewType       string            `json:"view_type"`
	ViewQuery      string            `json:"view_query"`
	ViewTarget     string            `json:"view_target"`
	ReadRows       uint64            `json:"read_rows"`
	ReadBytes      uint64            `json:"read_bytes"`
	WrittenRows    uint64            `json:"written_rows"`
	WrittenBytes   uint64            `json:"written_bytes"`
	PeakMemory     int64             `json:"peak_memory_usage"`
	Status         string            `json:"status"`
	ExceptionCode  int32             `json:"exception_code"`
	Exception      string            `json:"exception"`
	ProfileEvents  map[string]uint64 `json:"profile_events"`
}

func (c *Client) GetQueryViews(ctx context.Context, queryID string) ([]ViewLogEntry, error) {
	table := c.tableRef("query_views_log")
	query := fmt.Sprintf(`SELECT
		event_time, view_duration_ms, view_name, view_type, view_query, view_target,
		read_rows, read_bytes, written_rows, written_bytes, peak_memory_usage,
		status, exception_code, exception, ProfileEvents
	FROM %s
	WHERE initial_query_id = ?
	ORDER BY event_time ASC`, table)

	rows, err := c.conn.Query(ctx, query, queryID)
	if err != nil {
		return nil, fmt.Errorf("querying query_views_log: %w", err)
	}
	defer rows.Close()

	var entries []ViewLogEntry
	for rows.Next() {
		var e ViewLogEntry
		if err := rows.Scan(
			&e.EventTime, &e.ViewDurationMs, &e.ViewName, &e.ViewType,
			&e.ViewQuery, &e.ViewTarget, &e.ReadRows, &e.ReadBytes,
			&e.WrittenRows, &e.WrittenBytes, &e.PeakMemory, &e.Status,
			&e.ExceptionCode, &e.Exception, &e.ProfileEvents,
		); err != nil {
			return nil, fmt.Errorf("scanning views row: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, nil
}
