package clickhouse

import (
	"context"
	"fmt"
	"strings"
)

type HealthReport struct {
	Connected     bool           `json:"connected"`
	ServerVersion string         `json:"server_version"`
	Uptime        uint32         `json:"uptime"`
	Cluster       string         `json:"cluster"`
	IsCluster     bool           `json:"is_cluster"`
	ClusterNote   string         `json:"cluster_note,omitempty"`
	Database      string         `json:"database"`
	User          string         `json:"user"`
	HostName      string         `json:"host_name"`
	LogTables     []LogTableSize `json:"log_tables"`
	Settings      []SettingValue `json:"settings"`
	Nodes         []NodeInfo     `json:"nodes"`
	Warnings      []string       `json:"warnings"`
}

type LogTableSize struct {
	Table             string `json:"table"`
	Rows              uint64 `json:"rows"`
	CompressedBytes   uint64 `json:"compressed_bytes"`
	UncompressedBytes uint64 `json:"uncompressed_bytes"`
	Exists            bool   `json:"exists"`
	Enabled           bool   `json:"enabled"`
}

type SettingValue struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

func (c *Client) HealthCheck(ctx context.Context) (*HealthReport, error) {
	report := &HealthReport{
		Connected:   true,
		Cluster:     c.cluster,
		IsCluster:   c.isCluster,
		ClusterNote: c.ClusterNote(),
		Database:    c.connDB,
		User:        c.connUser,
		LogTables:   []LogTableSize{},
		Settings:    []SettingValue{},
		Nodes:       []NodeInfo{},
		Warnings:    []string{},
	}

	if err := c.queryBasicInfo(ctx, report); err != nil {
		return nil, err
	}
	c.queryLogTableSizes(ctx, report)
	c.querySettings(ctx, report)
	c.queryNodes(ctx, report)
	c.deriveWarnings(report)

	return report, nil
}

func (c *Client) queryBasicInfo(ctx context.Context, r *HealthReport) error {
	var hostName, version string
	var uptime uint32
	if err := c.conn.QueryRow(ctx, "SELECT hostName(), version(), uptime()").Scan(&hostName, &version, &uptime); err != nil {
		return fmt.Errorf("querying basic info: %w", err)
	}
	r.HostName = hostName
	r.ServerVersion = version
	r.Uptime = uptime
	return nil
}

func (c *Client) queryLogTableSizes(ctx context.Context, r *HealthReport) {
	tables := c.tableRef("parts")
	sizeQuery := fmt.Sprintf(`SELECT
		table,
		sum(rows) AS rows,
		sum(bytes_on_disk) AS compressed_bytes,
		sum(data_uncompressed_bytes) AS uncompressed_bytes
	FROM %s
	WHERE active AND database = 'system'
		AND table IN ('query_log', 'query_thread_log', 'query_views_log', 'query_metric_log', 'trace_log')
	GROUP BY table`, tables)

	rows, err := c.conn.Query(ctx, sizeQuery)
	if err != nil {
		return
	}
	defer rows.Close()

	sizes := make(map[string]LogTableSize)
	for rows.Next() {
		var lt LogTableSize
		if err := rows.Scan(&lt.Table, &lt.Rows, &lt.CompressedBytes, &lt.UncompressedBytes); err != nil {
			continue
		}
		sizes[lt.Table] = lt
	}

	enabledTables := c.queryEnabledLogTables(ctx)

	allTables := []string{"query_log", "query_thread_log", "query_views_log", "query_metric_log", "trace_log"}
	for _, t := range allTables {
		lt := sizes[t]
		lt.Table = t
		lt.Exists = true
		lt.Enabled = enabledTables[t]
		if !lt.Enabled {
			lt.Exists = false
		}
		r.LogTables = append(r.LogTables, lt)
	}
}

func (c *Client) queryEnabledLogTables(ctx context.Context) map[string]bool {
	enabled := make(map[string]bool)
	rows, err := c.conn.Query(ctx, "SELECT name FROM system.tables WHERE database = 'system' AND name IN ('query_log', 'query_thread_log', 'query_views_log', 'query_metric_log', 'trace_log')")
	if err != nil {
		return enabled
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			enabled[name] = true
		}
	}
	return enabled
}

var healthSettings = []string{
	"log_queries",
	"log_query_threads",
	"log_query_views",
	"log_query_metrics",
	"allow_introspection_functions",
	"send_logs_level",
	"max_query_size",
}

func (c *Client) querySettings(ctx context.Context, r *HealthReport) {
	placeholders := make([]string, len(healthSettings))
	args := make([]interface{}, len(healthSettings))
	for i, s := range healthSettings {
		placeholders[i] = "?"
		args[i] = s
	}
	query := fmt.Sprintf("SELECT name, value FROM system.settings WHERE name IN (%s)", strings.Join(placeholders, ","))

	rows, err := c.conn.Query(ctx, query, args...)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var sv SettingValue
		if err := rows.Scan(&sv.Name, &sv.Value); err != nil {
			continue
		}
		r.Settings = append(r.Settings, sv)
	}
}

func (c *Client) queryNodes(ctx context.Context, r *HealthReport) {
	if c.isCluster {
		query := fmt.Sprintf(`SELECT hostName() AS host, uptime(), version() FROM clusterAllReplicas('%s', system.one)`, c.cluster)
		rows, err := c.conn.Query(ctx, query)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var n NodeInfo
				if err := rows.Scan(&n.Host, &n.Uptime, &n.Version); err == nil {
					r.Nodes = append(r.Nodes, n)
				}
			}
		}
	}
	if len(r.Nodes) == 0 {
		r.Nodes = []NodeInfo{{Host: r.HostName, Uptime: r.Uptime, Version: r.ServerVersion}}
	}
}

func (c *Client) deriveWarnings(r *HealthReport) {
	settingsMap := make(map[string]string)
	for _, s := range r.Settings {
		settingsMap[s.Name] = s.Value
	}

	if v, ok := settingsMap["log_queries"]; ok && v == "0" {
		r.Warnings = append(r.Warnings, "log_queries is disabled — query logs will not be collected. Set log_queries=1 in your ClickHouse config.")
	}
	if v, ok := settingsMap["log_query_threads"]; ok && v == "0" {
		r.Warnings = append(r.Warnings, "log_query_threads is disabled — thread-level profiling will not be available.")
	}
	if v, ok := settingsMap["allow_introspection_functions"]; ok && v == "0" {
		r.Warnings = append(r.Warnings, "allow_introspection_functions is disabled — flamegraphs require this. Set allow_introspection_functions=1.")
	}

	for _, lt := range r.LogTables {
		if lt.Table == "trace_log" && lt.Exists && lt.Rows == 0 {
			r.Warnings = append(r.Warnings, "trace_log is empty — sampling profiler is not configured. Set log_profiler_events=1 or trace_log enabled in ClickHouse config.")
		}
		if lt.Table == "query_log" && lt.Exists && lt.Rows == 0 {
			r.Warnings = append(r.Warnings, "query_log is empty — no queries have been logged yet.")
		}
	}

	if !r.IsCluster {
		for _, lt := range r.LogTables {
			if lt.Table == "query_log" && lt.Exists {
				estimate := float64(lt.UncompressedBytes) / 30.0
				if estimate > 1e9 {
					r.Warnings = append(r.Warnings, fmt.Sprintf("query_log retention may be too long: estimated %.1f GB/day. Consider TTL or rotate settings.", estimate/1e9))
				}
			}
		}
	}
}
