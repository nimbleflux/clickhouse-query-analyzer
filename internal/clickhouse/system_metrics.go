package clickhouse

import (
	"context"
	"fmt"
	"strings"
)

// AsyncMetric is one row of system.asynchronous_metrics — a periodically
// sampled gauge (OS stats, caches, memory trackers, load, etc.). The table
// holds the latest sample for each metric; history lives in
// system.asynchronous_metric_log (not exposed here — phase b).
type AsyncMetric struct {
	Metric      string  `json:"metric"`
	Value       float64 `json:"value"`
	Description string  `json:"description"`
}

// AsyncMetricsOverview wraps the metric rows with the node they belong to.
// asynchronous_metrics are per-node gauges queried locally (a cluster-wide
// fan-out would need a host column and balloon the payload), so the page must
// make clear which node the numbers describe.
type AsyncMetricsOverview struct {
	HostName  string        `json:"host_name"`
	IsCluster bool          `json:"is_cluster"`
	Cluster   string        `json:"cluster"`
	Metrics   []AsyncMetric `json:"metrics"`
}

func (c *Client) ListAsyncMetrics(ctx context.Context) (*AsyncMetricsOverview, error) {
	out := &AsyncMetricsOverview{IsCluster: c.isCluster, Cluster: c.cluster, Metrics: []AsyncMetric{}}

	// Hostname is informational; ignore failure (older/configured-out setups).
	var host string
	if err := c.conn.QueryRow(ctx, "SELECT hostName()").Scan(&host); err == nil {
		out.HostName = host
	}

	rows, err := c.conn.Query(ctx,
		"SELECT metric, value, description FROM system.asynchronous_metrics ORDER BY metric")
	if err != nil {
		return nil, fmt.Errorf("querying asynchronous_metrics: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var m AsyncMetric
		if err := rows.Scan(&m.Metric, &m.Value, &m.Description); err != nil {
			return nil, fmt.Errorf("scanning asynchronous_metric row: %w", err)
		}
		out.Metrics = append(out.Metrics, m)
	}
	return out, nil
}

// MetricCategory buckets an asynchronous-metric name into a coarse category for
// grouping in the UI. Names lack a structured category field, so this is a
// prefix/keyword heuristic — good enough for navigation, not authoritative.
func MetricCategory(metric string) string {
	m := metric
	switch {
	case strings.HasPrefix(m, "OS"):
		return "OS"
	case strings.HasPrefix(m, "Filesystem") || strings.Contains(m, "Disk") || strings.Contains(m, "disk_"):
		return "Disk"
	case strings.Contains(m, "Network") || strings.Contains(m, "network_") || strings.Contains(m, "Send") || strings.Contains(m, "Receive"):
		return "Network"
	case strings.Contains(m, "CPU"):
		return "CPU"
	case strings.Contains(m, "Memory") || strings.Contains(m, "memory"):
		return "Memory"
	case strings.HasSuffix(m, "Cache") || strings.Contains(m, "CacheSize") || strings.Contains(m, "_cache"):
		return "Caches"
	case strings.Contains(m, "Dictionary") || strings.Contains(m, "dictionary"):
		return "Dictionaries"
	case strings.Contains(m, "Replica") || strings.Contains(m, "replicated") || strings.Contains(m, "ZooKeeper") || strings.Contains(m, "Keeper"):
		return "Replication"
	case strings.Contains(m, "Query") || strings.Contains(m, "query") || strings.Contains(m, "HTTP") || strings.Contains(m, "Connection"):
		return "Server"
	default:
		return "Other"
	}
}
