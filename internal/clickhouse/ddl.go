package clickhouse

import (
	"context"
	"fmt"
	"strings"
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

type DDLStatus struct {
	DistributedDDL   []DistributedDDLEntry `json:"distributed_ddl"`
	RecentDDL        []RecentDDLEntry      `json:"recent_ddl"`
	PendingMutations uint64                `json:"pending_mutations"`
	StuckDDL         int                   `json:"stuck_ddl"`
	FailedDDL        int                   `json:"failed_ddl"`
	PartialErrors    []string              `json:"partial_errors"`
}

type DDLParams struct {
	Database string
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

	out := &DDLStatus{
		DistributedDDL: []DistributedDDLEntry{},
		RecentDDL:      []RecentDDLEntry{},
		PartialErrors:  []string{},
	}

	c.queryDistributedDDL(ctx, params, out)
	c.queryRecentDDL(ctx, params, out)
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
		out.PartialErrors = append(out.PartialErrors, "system.distributed_ddl_queue: "+err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var e DistributedDDLEntry
		if err := rows.Scan(&e.Query, &e.InitiatorHost, &e.Cluster, &e.Status,
			&e.ExceptionCode, &e.ExceptionText, &e.QueryCreateTime,
			&e.QueryFinishTime, &e.QueryDurationMs); err != nil {
			out.PartialErrors = append(out.PartialErrors, "system.distributed_ddl_queue scan: "+err.Error())
			return
		}
		out.DistributedDDL = append(out.DistributedDDL, e)
	}
}

func (c *Client) queryRecentDDL(ctx context.Context, params DDLParams, out *DDLStatus) {
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
		out.PartialErrors = append(out.PartialErrors, "system.query_log (ddl): "+err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var r RecentDDLEntry
		if err := rows.Scan(&r.EventTime, &r.QueryID, &r.QueryKind, &r.Query,
			&r.QueryDurationMs, &r.User, &r.Exception); err != nil {
			out.PartialErrors = append(out.PartialErrors, "system.query_log (ddl) scan: "+err.Error())
			return
		}
		out.RecentDDL = append(out.RecentDDL, r)
	}
}

func (c *Client) queryPendingMutationCount(ctx context.Context, out *DDLStatus) {
	table := c.tableRef("mutations")
	if err := c.conn.QueryRow(ctx, fmt.Sprintf("SELECT count() FROM %s WHERE is_done = 0", table)).Scan(&out.PendingMutations); err != nil {
		// Non-fatal: the link just reads zero.
		out.PendingMutations = 0
	}
}
