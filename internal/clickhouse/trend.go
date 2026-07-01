package clickhouse

import (
	"context"
	"fmt"
	"time"
)

type TrendPoint struct {
	Bucket         time.Time `json:"bucket"`
	ExecutionCount uint64    `json:"execution_count"`
	AvgDurationMs  float64   `json:"avg_duration_ms"`
	P50DurationMs  float64   `json:"p50_duration_ms"`
	P95DurationMs  float64   `json:"p95_duration_ms"`
	MaxDurationMs  uint64    `json:"max_duration_ms"`
	AvgMemoryUsage float64   `json:"avg_memory_usage"`
	MaxMemoryUsage uint64    `json:"max_memory_usage"`
	AvgReadRows    float64   `json:"avg_read_rows"`
	MaxReadRows    uint64    `json:"max_read_rows"`
	AvgReadBytes   float64   `json:"avg_read_bytes"`
	MaxReadBytes   uint64    `json:"max_read_bytes"`
	AvgResultRows  float64   `json:"avg_result_rows"`
	MaxResultRows  uint64    `json:"max_result_rows"`
	AvgPeakThreads float64   `json:"avg_peak_threads"`
	MaxPeakThreads uint64    `json:"max_peak_threads"`
	ErrorCount     uint64    `json:"error_count"`
}

func (c *Client) GetFingerprintTrend(ctx context.Context, hash uint64, interval string, fromTime string, toTime string) ([]TrendPoint, error) {
	table := c.tableRef("query_log")

	validIntervals := map[string]bool{
		"minute": true, "hour": true, "day": true,
	}
	if !validIntervals[interval] {
		interval = "hour"
	}

	where := "WHERE normalized_query_hash = ? AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')"
	args := []interface{}{hash}

	if fromTime != "" {
		where += " AND event_time >= ?"
		args = append(args, fromTime)
	}
	if toTime != "" {
		where += " AND event_time <= ?"
		args = append(args, toTime)
	}

	query := fmt.Sprintf(`SELECT
		toStartOfInterval(event_time, INTERVAL 1 %s) AS bucket,
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
		avg(result_rows) AS avg_result_rows,
		max(result_rows) AS max_result_rows,
		avg(peak_threads_usage) AS avg_peak_threads,
		max(peak_threads_usage) AS max_peak_threads,
		countIf(type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')) AS error_count
	FROM %s %s
		GROUP BY bucket
		ORDER BY bucket`, interval, table, where)

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying fingerprint trend: %w", err)
	}
	defer rows.Close()

	var points []TrendPoint
	for rows.Next() {
		var p TrendPoint
		if err := rows.Scan(
			&p.Bucket, &p.ExecutionCount,
			&p.AvgDurationMs, &p.P50DurationMs, &p.P95DurationMs, &p.MaxDurationMs,
			&p.AvgMemoryUsage, &p.MaxMemoryUsage,
			&p.AvgReadRows, &p.MaxReadRows,
			&p.AvgReadBytes, &p.MaxReadBytes,
			&p.AvgResultRows, &p.MaxResultRows,
			&p.AvgPeakThreads, &p.MaxPeakThreads,
			&p.ErrorCount,
		); err != nil {
			return nil, fmt.Errorf("scanning trend point: %w", err)
		}
		points = append(points, p)
	}
	if points == nil {
		points = []TrendPoint{}
	}
	return points, nil
}

// QueryHealthPoint is one time bucket of aggregate query-log health: volume,
// latency (p50/p95), memory, and errors. Used by the Trends page to answer
// "is the cluster getting slower / erroring more?".
type QueryHealthPoint struct {
	Bucket        time.Time `json:"bucket"`
	Count         uint64    `json:"count"`
	P50DurationMs float64   `json:"p50_duration_ms"`
	P95DurationMs float64   `json:"p95_duration_ms"`
	AvgMemory     float64   `json:"avg_memory"`
	Errors        uint64    `json:"errors"`
}

// GetQueryHealthTrend buckets all user queries over the last `hours` hours and
// reports per-bucket count/p50/p95 latency, average memory, and error count.
// The bucket width scales with the window so the chart stays readable.
func (c *Client) GetQueryHealthTrend(ctx context.Context, hours int) ([]QueryHealthPoint, error) {
	if hours <= 0 {
		hours = 24
	}
	bucketMinutes := 60
	switch hours {
	case 1:
		bucketMinutes = 5
	case 168:
		bucketMinutes = 360
	}
	table := c.tableRef("query_log")
	query := fmt.Sprintf(`SELECT
		toStartOfInterval(event_time, INTERVAL %d MINUTE) AS bucket,
		count() AS count,
		quantile(0.5)(query_duration_ms) AS p50,
		quantile(0.95)(query_duration_ms) AS p95,
		avg(memory_usage) AS avg_mem,
		countIf(type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')) AS errors
	FROM %s
	WHERE event_time >= now() - INTERVAL %d HOUR
		AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
		AND is_initial_query = 1
		AND log_comment != '%s'
	GROUP BY bucket
	ORDER BY bucket`, bucketMinutes, table, hours, managedLogComment)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying query health trend: %w", err)
	}
	defer rows.Close()

	var out []QueryHealthPoint
	for rows.Next() {
		var p QueryHealthPoint
		if err := rows.Scan(&p.Bucket, &p.Count, &p.P50DurationMs, &p.P95DurationMs, &p.AvgMemory, &p.Errors); err != nil {
			return nil, fmt.Errorf("scanning query health point: %w", err)
		}
		out = append(out, p)
	}
	if out == nil {
		out = []QueryHealthPoint{}
	}
	return out, nil
}
