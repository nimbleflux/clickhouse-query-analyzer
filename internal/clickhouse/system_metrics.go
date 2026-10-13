package clickhouse

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// finiteFloat marshals NaN/Inf as null. JSON has no representation for
// non-finite floats — several asynchronous_metrics are NaN on containers
// (disk stats over overlayfs, for example) — and a marshal failure inside
// writeJSON used to swallow the whole response into an empty 200.
type finiteFloat float64

func (f finiteFloat) MarshalJSON() ([]byte, error) {
	if math.IsNaN(float64(f)) || math.IsInf(float64(f), 0) {
		return []byte("null"), nil
	}
	// Delegate to the standard encoder so finite values keep the exact
	// representation encoding/json always produced.
	return json.Marshal(float64(f))
}

// AsyncMetric is one row of system.asynchronous_metrics — a periodically
// sampled gauge (OS stats, caches, memory trackers, load, etc.) tagged with
// the node it came from. The table holds the latest sample for each metric;
// history lives in system.asynchronous_metric_log (not exposed here — phase b).
type AsyncMetric struct {
	Host        string      `json:"host"`
	Metric      string      `json:"metric"`
	Value       finiteFloat `json:"value"`
	Description string      `json:"description"`
}

// AsyncMetricsOverview wraps the metric rows with the set of nodes they span.
// On a cluster the query fans out via clusterAllReplicas so every metric is
// host-tagged and the UI can offer a per-node view — making it unambiguous
// which node a gauge applies to (matching the dashboard's per-row host tags).
type AsyncMetricsOverview struct {
	IsCluster bool          `json:"is_cluster"`
	Cluster   string        `json:"cluster"`
	Hosts     []string      `json:"hosts"`
	Metrics   []AsyncMetric `json:"metrics"`
}

func (c *Client) ListAsyncMetrics(ctx context.Context) (*AsyncMetricsOverview, error) {
	out := &AsyncMetricsOverview{IsCluster: c.isCluster, Cluster: c.cluster, Hosts: []string{}, Metrics: []AsyncMetric{}}

	// tableRef fans out to clusterAllReplicas on a cluster, local otherwise.
	// hostName() resolves per-replica, so each row carries its origin node.
	table := c.tableRef("asynchronous_metrics")
	orderBy := "metric"
	if c.isCluster {
		orderBy = "host, metric"
	}
	query := fmt.Sprintf("SELECT hostName() AS host, metric, value, description FROM %s ORDER BY %s", table, orderBy)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying asynchronous_metrics: %w", err)
	}
	defer rows.Close()

	seen := map[string]struct{}{}
	for rows.Next() {
		var m AsyncMetric
		// Scan the value as plain float64 — the driver assigns strictly by
		// type, and finiteFloat is only a marshal-time wrapper.
		var value float64
		if err := rows.Scan(&m.Host, &m.Metric, &value, &m.Description); err != nil {
			return nil, fmt.Errorf("scanning asynchronous_metric row: %w", err)
		}
		m.Value = finiteFloat(value)
		out.Metrics = append(out.Metrics, m)
		if _, ok := seen[m.Host]; !ok {
			seen[m.Host] = struct{}{}
			out.Hosts = append(out.Hosts, m.Host)
		}
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
