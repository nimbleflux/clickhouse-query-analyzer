package clickhouse

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// DistributedDDLEntry is one row of system.distributed_ddl_queue — the per-host
// view of ON CLUSTER DDL operations. A row that isn't "Finished" (especially
// with an exception) is the canonical "stuck DDL" signal in ClickHouse.
type DistributedDDLEntry struct {
	Query           string `json:"query"`
	InitiatorHost   string `json:"initiator_host"`
	Cluster         string `json:"cluster"`
	Status          string `json:"status"`
	ExceptionCode   uint16 `json:"exception_code"`
	ExceptionText   string `json:"exception_text"`
	QueryCreateTime string `json:"query_create_time"`
	QueryFinishTime string `json:"query_finish_time"`
	QueryDurationMs uint64 `json:"query_duration_ms"`
}

// RecentDDLEntry is a recent DDL operation pulled from system.query_log.
// Catches non-distributed DDL trouble (a slow ALTER, a failed CREATE) that
// never enters the distributed queue.
type RecentDDLEntry struct {
	EventTime       string `json:"event_time"`
	QueryID         string `json:"query_id"`
	QueryKind       string `json:"query_kind"`
	Query           string `json:"query"`
	QueryDurationMs uint64 `json:"query_duration_ms"`
	User            string `json:"user"`
	Exception       string `json:"exception"`
}

// DDLOpsPoint is one time bucket of DDL activity (ok + failed counts) for the
// ops-over-time chart.
type DDLOpsPoint struct {
	Bucket string `json:"bucket"`
	Total  uint64 `json:"total"`
	Failed uint64 `json:"failed"`
}

type DDLStatus struct {
	DistributedDDL      []DistributedDDLEntry `json:"distributed_ddl"`
	RecentDDL           []RecentDDLEntry      `json:"recent_ddl"`
	Trend               []DDLOpsPoint         `json:"trend"`
	Hours               int                   `json:"hours"`
	PendingMutations    uint64                `json:"pending_mutations"`
	StuckDDL            int                   `json:"stuck_ddl"`
	FailedDDL           int                   `json:"failed_ddl"`
	ClusterNote         string                `json:"cluster_note,omitempty"`
	PartialErrors       []string              `json:"partial_errors"`
	PartialErrorDetails map[string]string     `json:"partial_error_details,omitempty"`
}

// addPartial mirrors ReplicationStatus.addPartial: clean table name for the
// banner, raw message for the hover tooltip.
func (s *DDLStatus) addPartial(table string, err error) {
	if err == nil {
		return
	}
	if s.PartialErrorDetails == nil {
		s.PartialErrorDetails = map[string]string{}
	}
	if _, ok := s.PartialErrorDetails[table]; !ok {
		s.PartialErrors = append(s.PartialErrors, table)
	}
	s.PartialErrorDetails[table] = err.Error()
}

type DDLParams struct {
	Database string
	Hours    int // lookback window; 0 = all time
	Limit    int
}

// ddlKinds are the query_log query_kind values that count as DDL.
var ddlKinds = []string{"Create", "Alter", "Drop", "Rename", "Attach", "Detach", "Truncate"}

func (c *Client) GetDDL(ctx context.Context, params DDLParams) (*DDLStatus, error) {
	if params.Limit <= 0 {
		params.Limit = 200
	}
	if params.Limit > 1000 {
		params.Limit = 1000
	}
	if params.Hours < 0 {
		params.Hours = 0
	}

	// Recent DDL is bounded by the lookback window; the distributed queue is
	// current-state and ignores it. Pick a bucket size that yields a readable
	// point count for the window.
	fromTime := ""
	if params.Hours > 0 {
		fromTime = time.Now().Add(-time.Duration(params.Hours) * time.Hour).Format("2006-01-02 15:04:05")
	}
	bucketMinutes := 30
	switch {
	case params.Hours <= 1:
		bucketMinutes = 5
	case params.Hours <= 24:
		bucketMinutes = 30
	case params.Hours <= 168:
		bucketMinutes = 360
	}
	// The trend chart always has a window so "All" still renders bars: cap it
	// at the last 30 days with 1-day buckets. recent_ddl stays genuinely
	// unbounded in All mode (fromTime == "").
	trendFromTime := fromTime
	trendBucket := bucketMinutes
	if params.Hours == 0 {
		trendFromTime = time.Now().Add(-30 * 24 * time.Hour).Format("2006-01-02 15:04:05")
		trendBucket = 1440
	}

	out := &DDLStatus{
		DistributedDDL: []DistributedDDLEntry{},
		RecentDDL:      []RecentDDLEntry{},
		Trend:          []DDLOpsPoint{},
		Hours:          params.Hours,
		PartialErrors:  []string{},
	}

	c.queryDistributedDDL(ctx, params, out)
	c.queryRecentDDL(ctx, params, fromTime, out)
	c.queryDDLTrend(ctx, trendFromTime, trendBucket, out)
	c.queryPendingMutationCount(ctx, out)

	// "Stuck" = a distributed entry that isn't Finished (Active/Inactive/
	// Removing/Unknown) — i.e. queued or in-flight. A non-empty exception
	// escalates it to "failed" for the summary badge.
	for _, e := range out.DistributedDDL {
		if e.Status != "Finished" {
			out.StuckDDL++
			if e.ExceptionText != "" {
				out.FailedDDL++
			}
		}
	}
	for _, r := range out.RecentDDL {
		if r.Exception != "" {
			out.FailedDDL++
		}
	}

	out.ClusterNote = c.ClusterNote()
	return out, nil
}

func (c *Client) queryDistributedDDL(ctx context.Context, params DDLParams, out *DDLStatus) {
	table := c.tableRef("distributed_ddl_queue")
	where := ""
	args := []interface{}{}
	if params.Database != "" {
		// distributed_ddl_queue has no database column; filter on the query
		// text instead so the database filter still narrows usefully.
		where = "WHERE positionCaseInsensitive(query, ?) > 0"
		args = append(args, params.Database)
	}
	// Every column here is Nullable; coalesce so the scan is into plain types.
	query := fmt.Sprintf(`SELECT
		query,
		ifNull(initiator_host, ''),
		ifNull(cluster, ''),
		COALESCE(toString(status), 'Unknown'),
		toUInt16(ifNull(exception_code, 0)),
		ifNull(exception_text, ''),
		ifNull(toString(query_create_time), ''),
		ifNull(toString(query_finish_time), ''),
		toUInt64(ifNull(query_duration_ms, 0))
	FROM %s %s
	ORDER BY query_create_time DESC
	LIMIT %d`, table, where, params.Limit)

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		out.addPartial("system.distributed_ddl_queue", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var e DistributedDDLEntry
		if err := rows.Scan(&e.Query, &e.InitiatorHost, &e.Cluster, &e.Status,
			&e.ExceptionCode, &e.ExceptionText, &e.QueryCreateTime,
			&e.QueryFinishTime, &e.QueryDurationMs); err != nil {
			out.addPartial("system.distributed_ddl_queue", err)
			return
		}
		out.DistributedDDL = append(out.DistributedDDL, e)
	}
}

func (c *Client) queryRecentDDL(ctx context.Context, params DDLParams, fromTime string, out *DDLStatus) {
	table := c.tableRef("query_log")
	kinds := make([]string, len(ddlKinds))
	for i, k := range ddlKinds {
		kinds[i] = "'" + k + "'"
	}
	whereParts := []string{
		"type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')",
		"query_kind IN (" + strings.Join(kinds, ",") + ")",
	}
	args := []interface{}{}
	if fromTime != "" {
		whereParts = append(whereParts, "event_time >= ?")
		args = append(args, fromTime)
	}
	if params.Database != "" {
		whereParts = append(whereParts, "has(databases, ?)")
		args = append(args, params.Database)
	}
	query := fmt.Sprintf(`SELECT
		toString(event_time), query_id, ifNull(query_kind,''), query,
		query_duration_ms, ifNull(user,''), ifNull(exception,'')
	FROM %s
	WHERE %s
	ORDER BY event_time DESC
	LIMIT %d`, table, strings.Join(whereParts, " AND "), params.Limit)

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		out.addPartial("system.query_log", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var r RecentDDLEntry
		if err := rows.Scan(&r.EventTime, &r.QueryID, &r.QueryKind, &r.Query,
			&r.QueryDurationMs, &r.User, &r.Exception); err != nil {
			out.addPartial("system.query_log", err)
			return
		}
		out.RecentDDL = append(out.RecentDDL, r)
	}
}

// queryDDLTrend buckets DDL operations (ok vs failed) over the lookback window
// for the ops-over-time chart. Empty result (no DDL in the window) is fine —
// the frontend hides the chart.
func (c *Client) queryDDLTrend(ctx context.Context, fromTime string, bucketMinutes int, out *DDLStatus) {
	table := c.tableRef("query_log")
	kinds := make([]string, len(ddlKinds))
	for i, k := range ddlKinds {
		kinds[i] = "'" + k + "'"
	}
	query := fmt.Sprintf(`SELECT
		toString(toStartOfInterval(event_time, INTERVAL %d MINUTE)),
		count(),
		countIf(exception != '')
	FROM %s
	WHERE event_time >= ?
		AND type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
		AND query_kind IN (%s)
	GROUP BY 1
	ORDER BY 1`, bucketMinutes, table, strings.Join(kinds, ","))

	rows, err := c.conn.Query(ctx, query, fromTime)
	if err != nil {
		out.addPartial("system.query_log", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p DDLOpsPoint
		if err := rows.Scan(&p.Bucket, &p.Total, &p.Failed); err != nil {
			return
		}
		out.Trend = append(out.Trend, p)
	}
}

func (c *Client) queryPendingMutationCount(ctx context.Context, out *DDLStatus) {
	table := c.tableRef("mutations")
	if err := c.conn.QueryRow(ctx, fmt.Sprintf("SELECT count() FROM %s WHERE is_done = 0", table)).Scan(&out.PendingMutations); err != nil {
		// Non-fatal: the link reads zero, but surface the failure so the
		// banner can explain it (usually a missing SELECT grant).
		out.PendingMutations = 0
		out.addPartial("system.mutations", err)
	}
}
