package clickhouse

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

type TraceEntry struct {
	EventTime  time.Time `json:"event_time"`
	TraceType  string    `json:"trace_type"`
	ThreadID   uint64    `json:"thread_id"`
	ThreadName string    `json:"thread_name"`
	Trace      []uint64  `json:"trace"`
	Symbols    []string  `json:"symbols"`
	Lines      []string  `json:"lines"`
	Size       int64     `json:"size"`
}

func (c *Client) GetTraceLog(ctx context.Context, queryID string, traceType string) ([]TraceEntry, error) {
	table := c.tableRef("trace_log")

	typeFilter := ""
	args := []interface{}{queryID}
	if traceType != "" {
		typeFilter = " AND trace_type = ?"
		args = append(args, traceType)
	}

	query := fmt.Sprintf(`SELECT
		event_time, trace_type, thread_id, thread_name,
		trace, symbols, lines, size
	FROM %s
	WHERE query_id = ?%s
	ORDER BY event_time ASC
	LIMIT 10000`, table, typeFilter)

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying trace_log: %w", err)
	}
	defer rows.Close()

	var entries []TraceEntry
	for rows.Next() {
		var e TraceEntry
		if err := rows.Scan(
			&e.EventTime, &e.TraceType, &e.ThreadID, &e.ThreadName,
			&e.Trace, &e.Symbols, &e.Lines, &e.Size,
		); err != nil {
			return nil, fmt.Errorf("scanning trace row: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, nil
}

type FlameGraphStack struct {
	Name  string `json:"name"`
	Value uint64 `json:"value"`
}

func (c *Client) GetFlameGraph(ctx context.Context, queryID string, traceType string) ([]FlameGraphStack, error) {
	entries, err := c.GetTraceLog(ctx, queryID, traceType)
	if err != nil {
		return nil, err
	}

	counts := make(map[string]uint64)
	for _, e := range entries {
		parts := make([]string, len(e.Symbols))
		for i, s := range e.Symbols {
			parts[len(e.Symbols)-1-i] = s
		}
		stack := strings.Join(parts, ";")
		counts[stack]++
	}

	data := make([]FlameGraphStack, 0, len(counts))
	for stack, cnt := range counts {
		data = append(data, FlameGraphStack{Name: stack, Value: cnt})
	}
	sort.Slice(data, func(i, j int) bool { return data[i].Value > data[j].Value })
	if len(data) > 500 {
		data = data[:500]
	}
	return data, nil
}
