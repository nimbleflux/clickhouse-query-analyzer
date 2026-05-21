package clickhouse

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

type TopFunction struct {
	Name    string `json:"name"`
	Samples uint64 `json:"samples"`
	Percent float64 `json:"percent"`
}

type ThreadProfile struct {
	ThreadID       uint64            `json:"thread_id"`
	ThreadName     string            `json:"thread_name"`
	Role           string            `json:"role"`
	PeakMemory     int64             `json:"peak_memory_usage"`
	CurrentMemory  int64             `json:"memory_usage"`
	ReadRows       uint64            `json:"read_rows"`
	ReadBytes      uint64            `json:"read_bytes"`
	WrittenRows    uint64            `json:"written_rows"`
	WrittenBytes   uint64            `json:"written_bytes"`
	DurationMs     uint64            `json:"query_duration_ms"`
	ProfileEvents  map[string]uint64 `json:"profile_events"`
	TopFunctions   []TopFunction     `json:"top_functions"`
	TotalSamples   uint64            `json:"total_samples"`
}

func inferRole(pe map[string]uint64, threadName string) string {
	switch {
	case threadName == "TCPHandler":
		return "Coordinator"
	case threadName == "QueryPullPipeEx":
		return "Pipeline Manager"
	case threadName == "ThreadPoolRead":
		return "I/O Pool"
	}

	if pe["SelectedRows"] > 0 && pe["FilterTransformPassedRows"] > 0 {
		return "Scan + Filter"
	}
	if pe["SelectedRows"] > 0 {
		return "Table Scanner"
	}
	if pe["AggregatedKeys"] > 0 || pe["MergedRows"] > 0 {
		return "Aggregator"
	}
	if pe["InsertedRows"] > 0 {
		return "Insert Writer"
	}
	if pe["FilterTransformPassedRows"] > 0 {
		return "Filter"
	}
	if pe["CreatedReadBufferOrdinary"] > 0 {
		return "Reader"
	}
	return "Worker"
}

func (c *Client) GetThreadProfile(ctx context.Context, queryID string, threadID uint64) (*ThreadProfile, error) {
	threads, err := c.GetQueryThreads(ctx, queryID)
	if err != nil {
		return nil, err
	}

	var thread *ThreadEntry
	for i := range threads {
		if threads[i].ThreadID == threadID {
			thread = &threads[i]
			break
		}
	}
	if thread == nil {
		return nil, fmt.Errorf("thread %d not found for query %s", threadID, queryID)
	}

	role := inferRole(thread.ProfileEvents, thread.ThreadName)

	table := c.tableRef("trace_log")
	query := fmt.Sprintf(`SELECT
		symbols
	FROM %s
	WHERE query_id = ? AND thread_id = ? AND trace_type = 'MemorySample'
	ORDER BY event_time ASC`, table)

	rows, err := c.conn.Query(ctx, query, queryID, threadID)
	if err != nil {
		return nil, fmt.Errorf("querying trace_log for thread: %w", err)
	}
	defer rows.Close()

	funcCounts := make(map[string]uint64)
	var totalSamples uint64
	for rows.Next() {
		var symbols []string
		if err := rows.Scan(&symbols); err != nil {
			return nil, fmt.Errorf("scanning trace row: %w", err)
		}
		totalSamples++
		for _, sym := range symbols {
			if strings.HasPrefix(sym, "DB::") {
				trimmed := shortenSymbol(sym)
				funcCounts[trimmed]++
			}
		}
	}

	topFuncs := make([]TopFunction, 0, len(funcCounts))
	for name, cnt := range funcCounts {
		topFuncs = append(topFuncs, TopFunction{
			Name:    name,
			Samples: cnt,
			Percent: float64(cnt) / float64(totalSamples) * 100,
		})
	}
	sort.Slice(topFuncs, func(i, j int) bool { return topFuncs[i].Samples > topFuncs[j].Samples })
	if len(topFuncs) > 20 {
		topFuncs = topFuncs[:20]
	}

	return &ThreadProfile{
		ThreadID:      thread.ThreadID,
		ThreadName:    thread.ThreadName,
		Role:          role,
		PeakMemory:    thread.PeakMemoryUsage,
		CurrentMemory: thread.MemoryUsage,
		ReadRows:      thread.ReadRows,
		ReadBytes:     thread.ReadBytes,
		WrittenRows:   thread.WrittenRows,
		WrittenBytes:  thread.WrittenBytes,
		DurationMs:    thread.QueryDurationMs,
		ProfileEvents: thread.ProfileEvents,
		TopFunctions:  topFuncs,
		TotalSamples:  totalSamples,
	}, nil
}

func shortenSymbol(sym string) string {
	if idx := strings.Index(sym, "("); idx > 0 {
		sym = sym[:idx]
	}
	if idx := strings.Index(sym, " const"); idx > 0 {
		sym = sym[:idx]
	}
	const prefix = "DB::"
	if strings.HasPrefix(sym, prefix) {
		return sym[len(prefix):]
	}
	return sym
}

type ThreadSummary struct {
	ThreadID      uint64            `json:"thread_id"`
	ThreadName    string            `json:"thread_name"`
	Role          string            `json:"role"`
	PeakMemory    int64             `json:"peak_memory_usage"`
	CurrentMemory int64             `json:"memory_usage"`
	ReadRows      uint64            `json:"read_rows"`
	ReadBytes     uint64            `json:"read_bytes"`
	DurationMs    uint64            `json:"query_duration_ms"`
	UserTimeUs    uint64            `json:"user_time_us"`
	SystemTimeUs  uint64            `json:"system_time_us"`
	RealTimeUs    uint64            `json:"real_time_us"`
	DiskReadUs    uint64            `json:"disk_read_us"`
	FilterTotal   uint64            `json:"filter_total_rows"`
	FilterPassed  uint64            `json:"filter_passed_rows"`
	ProfileEvents map[string]uint64 `json:"profile_events"`
}

func (c *Client) GetThreadSummaries(ctx context.Context, queryID string) ([]ThreadSummary, error) {
	threads, err := c.GetQueryThreads(ctx, queryID)
	if err != nil {
		return nil, err
	}

	summaries := make([]ThreadSummary, 0, len(threads))
	for _, t := range threads {
		pe := t.ProfileEvents
		summaries = append(summaries, ThreadSummary{
			ThreadID:      t.ThreadID,
			ThreadName:    t.ThreadName,
			Role:          inferRole(pe, t.ThreadName),
			PeakMemory:    t.PeakMemoryUsage,
			CurrentMemory: t.MemoryUsage,
			ReadRows:      t.ReadRows,
			ReadBytes:     t.ReadBytes,
			DurationMs:    t.QueryDurationMs,
			UserTimeUs:    pe["UserTimeMicroseconds"],
			SystemTimeUs:  pe["SystemTimeMicroseconds"],
			RealTimeUs:    pe["RealTimeMicroseconds"],
			DiskReadUs:    pe["DiskReadElapsedMicroseconds"],
			FilterTotal:   pe["SelectedRows"],
			FilterPassed:  pe["FilterTransformPassedRows"],
			ProfileEvents: pe,
		})
	}

	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].PeakMemory > summaries[j].PeakMemory
	})

	return summaries, nil
}
