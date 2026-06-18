package clickhouse

import (
	"context"
	"fmt"
)

type SystemMetrics struct {
	Metric string `json:"metric"`
	Host   string `json:"host"`
	Value  uint64 `json:"value"`
}

type SystemEvent struct {
	Event string `json:"event"`
	Host  string `json:"host"`
	Value uint64 `json:"value"`
}

type DatabaseSize struct {
	Database          string `json:"database"`
	Tables            uint64 `json:"tables"`
	Rows              uint64 `json:"rows"`
	CompressedBytes   uint64 `json:"compressed_bytes"`
	UncompressedBytes uint64 `json:"uncompressed_bytes"`
}

type PartSummary struct {
	Database          string `json:"database"`
	Table             string `json:"table"`
	Parts             uint64 `json:"parts"`
	Rows              uint64 `json:"rows"`
	CompressedBytes   uint64 `json:"compressed_bytes"`
	UncompressedBytes uint64 `json:"uncompressed_bytes"`
}

type ReplicationQueueEntry struct {
	Database             string `json:"database"`
	Table                string `json:"table"`
	ReplicaName          string `json:"replica_name"`
	Position             uint64 `json:"position"`
	Type                 string `json:"type"`
	CreateTime           string `json:"create_time"`
	IsCurrentlyExecuting uint8  `json:"is_currently_executing"`
	NumTries             uint32 `json:"num_tries"`
	LastException        string `json:"last_exception"`
}

type ReplicaStatus struct {
	Database       string  `json:"database"`
	Table          string  `json:"table"`
	ReplicaName    string  `json:"replica_name"`
	IsLeader       uint8   `json:"is_leader"`
	IsReadOnly     uint8   `json:"is_readonly"`
	AbsoluteDelay  float64 `json:"absolute_delay"`
	QueueSize      uint64  `json:"queue_size"`
	InsertsInQueue uint64  `json:"inserts_in_queue"`
	MergesInQueue  uint64  `json:"merges_in_queue"`
	LogMaxIndex    uint64  `json:"log_max_index"`
	LogPointer     uint64  `json:"log_pointer"`
	TotalReplicas  uint8   `json:"total_replicas"`
	ActiveReplicas uint8   `json:"active_replicas"`
}

type NodeInfo struct {
	Host    string `json:"host"`
	Uptime  uint32 `json:"uptime"`
	Version string `json:"version"`
}

type DashboardData struct {
	Metrics          []SystemMetrics         `json:"metrics"`
	RecentEvents     []SystemEvent           `json:"recent_events"`
	DatabaseSizes    []DatabaseSize          `json:"database_sizes"`
	TopTablesBySize  []PartSummary           `json:"top_tables_by_size"`
	TopTablesByParts []PartSummary           `json:"top_tables_by_parts"`
	ReplicationQueue []ReplicationQueueEntry `json:"replication_queue"`
	ReplicaStatuses  []ReplicaStatus         `json:"replica_statuses"`
	Nodes            []NodeInfo              `json:"nodes"`
	LogTables        []LogTableSize          `json:"log_tables"`
	Settings         []SettingValue          `json:"settings"`
	Warnings         []string                `json:"warnings"`
	Cluster          string                  `json:"cluster"`
	IsCluster        bool                    `json:"is_cluster"`
	Database         string                  `json:"database"`
	User             string                  `json:"user"`
	HostName         string                  `json:"host_name"`
	PartialErrors    []string                `json:"partial_errors"`
}

func (c *Client) GetDashboard(ctx context.Context) (*DashboardData, error) {
	d := &DashboardData{
		LogTables:     []LogTableSize{},
		Settings:      []SettingValue{},
		Warnings:      []string{},
		Cluster:       c.cluster,
		IsCluster:     c.isCluster,
		Database:      c.connDB,
		User:          c.connUser,
		PartialErrors: []string{},
	}

	c.queryMetrics(ctx, d)
	c.queryRecentEvents(ctx, d)
	c.queryDatabaseSizes(ctx, d)
	c.queryTopTables(ctx, d)
	c.queryReplication(ctx, d)
	c.queryServerInfo(ctx, d)
	c.fillHostName(ctx, d)

	report := &HealthReport{}
	if len(d.Nodes) > 0 {
		report.Uptime = d.Nodes[0].Uptime
	}
	c.queryLogTableSizes(ctx, report)
	c.querySettings(ctx, report)
	c.deriveWarnings(report)
	d.LogTables = report.LogTables
	d.Settings = report.Settings
	d.Warnings = report.Warnings

	return d, nil
}

func (c *Client) fillHostName(ctx context.Context, d *DashboardData) {
	if len(d.Nodes) > 0 && d.Nodes[0].Host != "" {
		d.HostName = d.Nodes[0].Host
		return
	}
	var hostName string
	if err := c.conn.QueryRow(ctx, "SELECT hostName()").Scan(&hostName); err == nil {
		d.HostName = hostName
	}
}

func (c *Client) queryMetrics(ctx context.Context, d *DashboardData) {
	table := c.tableRef("metrics")
	query := fmt.Sprintf(`SELECT metric, hostName() AS host, toUInt64(value) AS value FROM %s ORDER BY metric`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		d.Metrics = []SystemMetrics{}
		d.PartialErrors = append(d.PartialErrors, "system.metrics")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var m SystemMetrics
		if err := rows.Scan(&m.Metric, &m.Host, &m.Value); err != nil {
			d.Metrics = []SystemMetrics{}
			return
		}
		d.Metrics = append(d.Metrics, m)
	}
	if d.Metrics == nil {
		d.Metrics = []SystemMetrics{}
	}
}

func (c *Client) queryRecentEvents(ctx context.Context, d *DashboardData) {
	table := c.tableRef("events")
	query := fmt.Sprintf(`SELECT event, hostName() AS host, toUInt64(value) AS value FROM %s WHERE value > 0 ORDER BY value DESC LIMIT 30`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		d.RecentEvents = []SystemEvent{}
		d.PartialErrors = append(d.PartialErrors, "system.events")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var e SystemEvent
		if err := rows.Scan(&e.Event, &e.Host, &e.Value); err != nil {
			d.RecentEvents = []SystemEvent{}
			return
		}
		d.RecentEvents = append(d.RecentEvents, e)
	}
	if d.RecentEvents == nil {
		d.RecentEvents = []SystemEvent{}
	}
}

func (c *Client) queryDatabaseSizes(ctx context.Context, d *DashboardData) {
	table := c.tableRef("parts")
	query := fmt.Sprintf(`SELECT
		database,
		countDistinct(table) AS tables,
		sum(rows) AS rows,
		sum(bytes_on_disk) AS compressed_bytes,
		sum(data_uncompressed_bytes) AS uncompressed_bytes
	FROM %s WHERE active
	GROUP BY database
	ORDER BY compressed_bytes DESC
	LIMIT 20`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		d.DatabaseSizes = []DatabaseSize{}
		d.PartialErrors = append(d.PartialErrors, "system.parts")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ds DatabaseSize
		if err := rows.Scan(&ds.Database, &ds.Tables, &ds.Rows, &ds.CompressedBytes, &ds.UncompressedBytes); err != nil {
			d.DatabaseSizes = []DatabaseSize{}
			return
		}
		d.DatabaseSizes = append(d.DatabaseSizes, ds)
	}
	if d.DatabaseSizes == nil {
		d.DatabaseSizes = []DatabaseSize{}
	}
}

func (c *Client) queryTopTables(ctx context.Context, d *DashboardData) {
	table := c.tableRef("parts")
	query := fmt.Sprintf(`SELECT
		database, table,
		count() AS parts,
		sum(rows) AS rows,
		sum(bytes_on_disk) AS compressed_bytes,
		sum(data_uncompressed_bytes) AS uncompressed_bytes
	FROM %s WHERE active
	GROUP BY database, table`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		d.TopTablesBySize = []PartSummary{}
		d.TopTablesByParts = []PartSummary{}
		if !sliceContains(d.PartialErrors, "system.parts") {
			d.PartialErrors = append(d.PartialErrors, "system.parts")
		}
		return
	}
	defer rows.Close()

	var all []PartSummary
	for rows.Next() {
		var ps PartSummary
		if err := rows.Scan(&ps.Database, &ps.Table, &ps.Parts, &ps.Rows, &ps.CompressedBytes, &ps.UncompressedBytes); err != nil {
			d.TopTablesBySize = []PartSummary{}
			d.TopTablesByParts = []PartSummary{}
			return
		}
		all = append(all, ps)
	}

	bySize := make([]PartSummary, len(all))
	copy(bySize, all)
	for i := 0; i < len(bySize)-1; i++ {
		for j := i + 1; j < len(bySize); j++ {
			if bySize[j].CompressedBytes > bySize[i].CompressedBytes {
				bySize[i], bySize[j] = bySize[j], bySize[i]
			}
		}
	}
	limit := 10
	if len(bySize) < limit {
		limit = len(bySize)
	}
	d.TopTablesBySize = bySize[:limit]

	byParts := make([]PartSummary, len(all))
	copy(byParts, all)
	for i := 0; i < len(byParts)-1; i++ {
		for j := i + 1; j < len(byParts); j++ {
			if byParts[j].Parts > byParts[i].Parts {
				byParts[i], byParts[j] = byParts[j], byParts[i]
			}
		}
	}
	limit = 10
	if len(byParts) < limit {
		limit = len(byParts)
	}
	d.TopTablesByParts = byParts[:limit]
}

func sliceContains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func (c *Client) queryReplication(ctx context.Context, d *DashboardData) {
	if !c.isCluster {
		d.ReplicationQueue = []ReplicationQueueEntry{}
		d.ReplicaStatuses = []ReplicaStatus{}
		return
	}

	table := c.tableRef("replication_queue")
	rows, err := c.conn.Query(ctx, fmt.Sprintf(`SELECT
		database, table, replica_name, position, type,
		toString(create_time), is_currently_executing, num_tries,
		toString(last_exception)
	FROM %s ORDER BY create_time DESC LIMIT 50`, table))
	if err != nil {
		d.ReplicationQueue = []ReplicationQueueEntry{}
	} else {
		defer rows.Close()
		for rows.Next() {
			var r ReplicationQueueEntry
			if err := rows.Scan(&r.Database, &r.Table, &r.ReplicaName, &r.Position, &r.Type,
				&r.CreateTime, &r.IsCurrentlyExecuting, &r.NumTries, &r.LastException); err == nil {
				d.ReplicationQueue = append(d.ReplicationQueue, r)
			}
		}
	}
	if d.ReplicationQueue == nil {
		d.ReplicationQueue = []ReplicationQueueEntry{}
	}

	rt := c.tableRef("replicas")
	rows2, err := c.conn.Query(ctx, fmt.Sprintf(`SELECT
		database, table, replica_name,
		is_leader, is_readonly,
		absolute_delay,
		queue_size, inserts_in_queue, merges_in_queue,
		log_max_index, log_pointer,
		total_replicas, active_replicas
	FROM %s ORDER BY absolute_delay DESC`, rt))
	if err != nil {
		d.ReplicaStatuses = []ReplicaStatus{}
	} else {
		defer rows2.Close()
		for rows2.Next() {
			var r ReplicaStatus
			if err := rows2.Scan(&r.Database, &r.Table, &r.ReplicaName,
				&r.IsLeader, &r.IsReadOnly, &r.AbsoluteDelay,
				&r.QueueSize, &r.InsertsInQueue, &r.MergesInQueue,
				&r.LogMaxIndex, &r.LogPointer,
				&r.TotalReplicas, &r.ActiveReplicas); err == nil {
				d.ReplicaStatuses = append(d.ReplicaStatuses, r)
			}
		}
	}
	if d.ReplicaStatuses == nil {
		d.ReplicaStatuses = []ReplicaStatus{}
	}
}

func (c *Client) queryServerInfo(ctx context.Context, d *DashboardData) {
	if c.isCluster {
		query := fmt.Sprintf(`SELECT hostName() AS host, uptime(), version() FROM clusterAllReplicas('%s', system.one)`, c.cluster)
		rows, err := c.conn.Query(ctx, query)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var n NodeInfo
				if err := rows.Scan(&n.Host, &n.Uptime, &n.Version); err == nil {
					d.Nodes = append(d.Nodes, n)
				}
			}
		}
	}
	if len(d.Nodes) == 0 {
		var n NodeInfo
		n.Host = "local"
		if err := c.conn.QueryRow(ctx, "SELECT uptime(), version()").Scan(&n.Uptime, &n.Version); err == nil {
			d.Nodes = append(d.Nodes, n)
		}
	}
}
