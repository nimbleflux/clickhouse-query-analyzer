package clickhouse

import (
	"context"
	"fmt"
	"strings"
)

// MutationEntry is a row from system.mutations (filtered to is_done = 0).
// Stuck mutations are a frequent hidden cause of replication lag: a long-running
// ALTER on one replica blocks the replication log pointer from advancing.
type MutationEntry struct {
	Database         string `json:"database"`
	Table            string `json:"table"`
	MutationID       string `json:"mutation_id"`
	Command          string `json:"command"`
	CreateTime       string `json:"create_time"`
	PartsToDo        uint64 `json:"parts_to_do"`
	IsDone           uint8  `json:"is_done"`
	LatestFailedPart string `json:"latest_failed_part"`
	LatestFailReason string `json:"latest_fail_reason"`
}

// ReplicationSummary is an aggregate snapshot derived from the fetched rows.
// Replica-driven fields (queue depth, lag, read-only count) are authoritative
// because system.replicas is fetched unbounded. Stuck-task counts come from the
// fetched queue page; sorting places stuck entries first so the count is
// accurate for any realistic queue depth.
type ReplicationSummary struct {
	TotalQueueDepth  uint32 `json:"total_queue_depth"`
	MaxAbsoluteDelay uint64 `json:"max_absolute_delay"`
	ReadOnlyReplicas uint64 `json:"readonly_replicas"`
	StuckTasks       uint64 `json:"stuck_tasks"`
	PendingMutations uint64 `json:"pending_mutations"`
	ReplicaCount     uint64 `json:"replica_count"`
}

// KeeperStatus is one row of system.zookeeper_connection — the live Keeper
// session(s) for the connected node. If Keeper is unreachable, replication
// silently stalls and nothing else on the page explains why.
type KeeperStatus struct {
	Port                 uint16 `json:"port"`
	SessionUptimeSeconds uint64 `json:"session_uptime_seconds"`
	IsExpired            uint8  `json:"is_expired"`
	ConnectedTime        string `json:"connected_time"`
}

// ReplicationMetricPoint is one row of system.metric_log restricted to the
// replication/Keeper gauges. Cluster-wide concurrent-op counters (not lag) —
// the lag time-series is not exposed in this ClickHouse version.
type ReplicationMetricPoint struct {
	EventTime               string `json:"event_time"`
	ReadonlyReplica         int64  `json:"readonly_replica"`
	ReplicatedFetch         int64  `json:"replicated_fetch"`
	ReplicatedSend          int64  `json:"replicated_send"`
	ReplicatedChecks        int64  `json:"replicated_checks"`
	ZooKeeperSession        int64  `json:"zk_session"`
	ZooKeeperSessionExpired int64  `json:"zk_session_expired"`
}

type ReplicationParams struct {
	Database       string
	IncludeHistory bool
	Limit          int
	Offset         int
}

type ReplicationStatus struct {
	ReplicaStatuses     []ReplicaStatus          `json:"replica_statuses"`
	ReplicationQueue    []ReplicationQueueEntry  `json:"replication_queue"`
	Mutations           []MutationEntry          `json:"mutations"`
	Keeper              []KeeperStatus           `json:"keeper"`
	MetricHistory       []ReplicationMetricPoint `json:"metric_history"`
	Summary             ReplicationSummary       `json:"summary"`
	ClusterNote         string                   `json:"cluster_note,omitempty"`
	PartialErrors       []string                 `json:"partial_errors"`
	PartialErrorDetails map[string]string        `json:"partial_error_details,omitempty"`
}

// addPartial records a per-section failure: the table name (deduped) goes in
// PartialErrors for the banner, and the raw message goes in
// PartialErrorDetails for a hover tooltip. Lets restricted users see *why* a
// section is empty (usually missing SELECT privileges) instead of a misleading
// "no data" state.
func (s *ReplicationStatus) addPartial(table string, err error) {
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

// GetReplication assembles the full replication view. Unlike the dashboard's
// queryReplication, this runs regardless of isCluster: a single-node
// ReplicatedMergeTree setup still populates system.replicas, and many dev/small
// deployments run replicated tables without a system.clusters entry.
func (c *Client) GetReplication(ctx context.Context, params ReplicationParams) (*ReplicationStatus, error) {
	if params.Limit <= 0 {
		params.Limit = 200
	}
	if params.Limit > 1000 {
		params.Limit = 1000
	}
	if params.Offset < 0 {
		params.Offset = 0
	}

	out := &ReplicationStatus{
		ReplicaStatuses:  []ReplicaStatus{},
		ReplicationQueue: []ReplicationQueueEntry{},
		Mutations:        []MutationEntry{},
		Keeper:           []KeeperStatus{},
		MetricHistory:    []ReplicationMetricPoint{},
		PartialErrors:    []string{},
	}

	c.queryReplicaStatuses(ctx, params.Database, out)
	c.queryReplicationQueue(ctx, params, out)
	c.queryMutations(ctx, params.Database, out)
	c.queryKeeper(ctx, out)
	// The 24h metric history is the heavy part of the payload and barely moves
	// between refreshes, so the caller opts in (initial load / manual refresh)
	// rather than pulling it on every live tick.
	if params.IncludeHistory {
		c.queryMetricHistory(ctx, out)
	}

	out.Summary = c.deriveReplicationSummary(out)
	out.ClusterNote = c.ClusterNote()
	return out, nil
}

func (c *Client) queryReplicaStatuses(ctx context.Context, database string, out *ReplicationStatus) {
	table := c.tableRef("replicas")
	where := ""
	args := []interface{}{}
	if database != "" {
		where = "WHERE database = ?"
		args = append(args, database)
	}
	query := fmt.Sprintf(`SELECT
		database, table, replica_name,
		is_leader, is_readonly,
		absolute_delay,
		queue_size, inserts_in_queue, merges_in_queue,
		log_max_index, log_pointer,
		total_replicas, active_replicas,
		if(queue_size > 0, toString(queue_oldest_time), '') AS queue_oldest_time,
		is_session_expired
	FROM %s %s
	ORDER BY absolute_delay DESC`, table, where)

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		out.addPartial("system.replicas", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var r ReplicaStatus
		if err := rows.Scan(&r.Database, &r.Table, &r.ReplicaName,
			&r.IsLeader, &r.IsReadOnly, &r.AbsoluteDelay,
			&r.QueueSize, &r.InsertsInQueue, &r.MergesInQueue,
			&r.LogMaxIndex, &r.LogPointer,
			&r.TotalReplicas, &r.ActiveReplicas,
			&r.QueueOldestTime, &r.IsSessionExpired); err != nil {
			out.addPartial("system.replicas", err)
			return
		}
		out.ReplicaStatuses = append(out.ReplicaStatuses, r)
	}
	if err := rows.Err(); err != nil {
		out.addPartial("system.replicas", err)
	}
}

func (c *Client) queryReplicationQueue(ctx context.Context, params ReplicationParams, out *ReplicationStatus) {
	table := c.tableRef("replication_queue")

	whereParts := []string{}
	args := []interface{}{}
	if params.Database != "" {
		whereParts = append(whereParts, "database = ?")
		args = append(args, params.Database)
	}
	where := ""
	if len(whereParts) > 0 {
		where = "WHERE " + strings.Join(whereParts, " AND ")
	}

	// Stuck tasks (high num_tries) first, then newest — so the summary's
	// stuck count is accurate across the fetched page for realistic queues.
	query := fmt.Sprintf(`SELECT
		database, table, replica_name, position, type,
		toString(create_time), is_currently_executing, num_tries,
		toString(last_exception), num_postponed, postpone_reason, source_replica
	FROM %s %s
	ORDER BY num_tries DESC, create_time DESC
	LIMIT %d OFFSET %d`, table, where, params.Limit, params.Offset)

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		out.addPartial("system.replication_queue", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var r ReplicationQueueEntry
		if err := rows.Scan(&r.Database, &r.Table, &r.ReplicaName, &r.Position, &r.Type,
			&r.CreateTime, &r.IsCurrentlyExecuting, &r.NumTries, &r.LastException,
			&r.NumPostponed, &r.PostponeReason, &r.SourceReplica); err != nil {
			out.addPartial("system.replication_queue", err)
			return
		}
		out.ReplicationQueue = append(out.ReplicationQueue, r)
	}
}

func (c *Client) queryMutations(ctx context.Context, database string, out *ReplicationStatus) {
	table := c.tableRef("mutations")
	whereParts := []string{"is_done = 0"}
	args := []interface{}{}
	if database != "" {
		whereParts = append(whereParts, "database = ?")
		args = append(args, database)
	}
	query := fmt.Sprintf(`SELECT
		database, table, mutation_id, command,
		toString(create_time), parts_to_do, is_done,
		latest_failed_part, latest_fail_reason
	FROM %s
	WHERE %s
	ORDER BY create_time DESC
	LIMIT 500`, table, strings.Join(whereParts, " AND "))

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		out.addPartial("system.mutations", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m MutationEntry
		if err := rows.Scan(&m.Database, &m.Table, &m.MutationID, &m.Command,
			&m.CreateTime, &m.PartsToDo, &m.IsDone,
			&m.LatestFailedPart, &m.LatestFailReason); err != nil {
			out.addPartial("system.mutations", err)
			return
		}
		out.Mutations = append(out.Mutations, m)
	}
}

// queryKeeper reads the connected node's Keeper session(s). Local table on
// purpose: the Keeper connection belongs to the node ClickLens talks to.
func (c *Client) queryKeeper(ctx context.Context, out *ReplicationStatus) {
	query := `SELECT port, session_uptime_elapsed_seconds, is_expired, toString(connected_time)
		FROM system.zookeeper_connection`
	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		out.addPartial("system.zookeeper_connection", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var k KeeperStatus
		if err := rows.Scan(&k.Port, &k.SessionUptimeSeconds, &k.IsExpired, &k.ConnectedTime); err != nil {
			out.addPartial("system.zookeeper_connection", err)
			return
		}
		out.Keeper = append(out.Keeper, k)
	}
}

// queryMetricHistory pulls the last 24h of replication/Keeper gauges from
// system.metric_log. Bucketed to 5-minute maxes so the payload is bounded
// (~288 points) regardless of the cluster's metric_log collect interval —
// some installs collect every second, which would otherwise yield tens of
// thousands of points and swamp the chart render. Optional: not every
// deployment enables metric_log, so a failure (or empty result) is surfaced
// as an empty slice, not an error — the frontend hides the charts then.
func (c *Client) queryMetricHistory(ctx context.Context, out *ReplicationStatus) {
	query := `SELECT toString(toStartOfInterval(event_time, INTERVAL 5 MINUTE)),
		max(CurrentMetric_ReadonlyReplica),
		max(CurrentMetric_ReplicatedFetch),
		max(CurrentMetric_ReplicatedSend),
		max(CurrentMetric_ReplicatedChecks),
		max(CurrentMetric_ZooKeeperSession),
		max(CurrentMetric_ZooKeeperSessionExpired)
	FROM system.metric_log
	WHERE event_time > now() - INTERVAL 24 HOUR
	GROUP BY 1
	ORDER BY 1`
	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		// metric_log disabled/absent/inaccessible — non-fatal; the charts
		// stay hidden, but record the failure so the banner can explain why.
		out.addPartial("system.metric_log", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p ReplicationMetricPoint
		if err := rows.Scan(&p.EventTime, &p.ReadonlyReplica, &p.ReplicatedFetch,
			&p.ReplicatedSend, &p.ReplicatedChecks, &p.ZooKeeperSession,
			&p.ZooKeeperSessionExpired); err != nil {
			out.addPartial("system.metric_log", err)
			return
		}
		out.MetricHistory = append(out.MetricHistory, p)
	}
}

// deriveReplicationSummary computes aggregate stats from the fetched rows.
// Replica-driven fields are exact (system.replicas is unbounded); the stuck-task
// count relies on the queue sort placing high-try entries on the fetched page.
func (c *Client) deriveReplicationSummary(out *ReplicationStatus) ReplicationSummary {
	s := ReplicationSummary{ReplicaCount: uint64(len(out.ReplicaStatuses))}
	for _, r := range out.ReplicaStatuses {
		s.TotalQueueDepth += r.QueueSize
		if r.AbsoluteDelay > s.MaxAbsoluteDelay {
			s.MaxAbsoluteDelay = r.AbsoluteDelay
		}
		if r.IsReadOnly == 1 {
			s.ReadOnlyReplicas++
		}
	}
	for _, q := range out.ReplicationQueue {
		if q.NumTries > 3 {
			s.StuckTasks++
		}
	}
	s.PendingMutations = uint64(len(out.Mutations))
	return s
}
