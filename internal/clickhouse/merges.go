package clickhouse

import (
	"context"
	"fmt"
)

// MergeEntry is one row of system.merges — an in-progress merge (or
// mutation-driven merge). The table holds only active merges, so no is_active
// filter is needed. progress is 0..1. Read-only by design: there is no safe
// per-merge kill, and SYSTEM STOP MERGES is global/dangerous (not exposed).
type MergeEntry struct {
	Database       string  `json:"database"`
	Table          string  `json:"table"`
	Elapsed        float64 `json:"elapsed"`
	Progress       float64 `json:"progress"`
	NumParts       uint64  `json:"num_parts"`
	ResultPart     string  `json:"result_part_name"`
	TotalBytes     uint64  `json:"total_size_bytes_compressed"`
	RowsRead       uint64  `json:"rows_read"`
	MemoryUsage    uint64  `json:"memory_usage"`
	MergeType      string  `json:"merge_type"`
	MergeAlgorithm string  `json:"merge_algorithm"`
	IsMutation     uint8   `json:"is_mutation"`
}

func (c *Client) ListMerges(ctx context.Context) ([]MergeEntry, error) {
	table := c.tableRef("merges")
	query := fmt.Sprintf(`SELECT
		database, table, elapsed, progress, num_parts, result_part_name,
		total_size_bytes_compressed, rows_read, memory_usage,
		merge_type, merge_algorithm, is_mutation
	FROM %s
	ORDER BY elapsed DESC
	LIMIT 500`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying merges: %w", err)
	}
	defer rows.Close()

	var out []MergeEntry
	for rows.Next() {
		var m MergeEntry
		if err := rows.Scan(
			&m.Database, &m.Table, &m.Elapsed, &m.Progress, &m.NumParts, &m.ResultPart,
			&m.TotalBytes, &m.RowsRead, &m.MemoryUsage,
			&m.MergeType, &m.MergeAlgorithm, &m.IsMutation,
		); err != nil {
			return nil, fmt.Errorf("scanning merge row: %w", err)
		}
		out = append(out, m)
	}
	if out == nil {
		out = []MergeEntry{}
	}
	return out, nil
}
