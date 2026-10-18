package clickhouse

import (
	"context"
	"fmt"
)

// PartDetail is one active data part of a MergeTree table (system.parts).
// The parts explorer answers "WHY does this table have so many parts" —
// which partitions are fragmented, how fresh the parts are, and what a
// OPTIMIZE / PARTITION-level action would actually touch.
type PartDetail struct {
	Name      string `json:"name"`
	Partition string `json:"partition"`
	Rows      uint64 `json:"rows"`
	Bytes     uint64 `json:"bytes_on_disk"`
	MarkCount uint64 `json:"marks"`
	ModTime   string `json:"modification_time"`
	// AgeSeconds is derived (dateDiff against now()) — system.parts has no
	// age column; the UI uses it for the humanized "3m / 2h / 5d" cell.
	AgeSeconds  int64  `json:"age_seconds"`
	PrimarySize uint64 `json:"primary_key_bytes_in_memory"`
}

// PartsSummary aggregates one table's active parts (per-partition rollup)
// so the parts view can show the whole picture even when the part list is
// truncated.
type PartsSummary struct {
	Parts        uint64                  `json:"parts"`
	Rows         uint64                  `json:"rows"`
	Bytes        uint64                  `json:"bytes_on_disk"`
	Partition    string                  `json:"partition"`
	PerPartition []PartsPartitionSummary `json:"per_partition"`
}

// PartsPartitionSummary aggregates one partition's active parts — same shape
// the table optimizer already surfaces, reused for the per-table parts view.
type PartsPartitionSummary struct {
	Partition string `json:"partition"`
	Parts     uint64 `json:"parts"`
	Rows      uint64 `json:"rows"`
	Bytes     uint64 `json:"bytes_on_disk"`
}

// ListTableParts returns the active parts of one table, most recent first,
// capped to keep the payload sane on pathological tables (100k+ parts).
func (c *Client) ListTableParts(ctx context.Context, database, table string, limit int) ([]PartDetail, PartsSummary, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 5000 {
		limit = 5000
	}

	q := fmt.Sprintf(`
		SELECT name, partition, rows, bytes_on_disk, marks,
		       toString(modification_time),
		       dateDiff('second', modification_time, now()) AS age,
		       COALESCE(primary_key_bytes_in_memory, 0)
		FROM %s
		WHERE database = ? AND table = ? AND active
		ORDER BY modification_time DESC
		LIMIT %d`, c.tableRef("parts"), limit)

	rows, err := c.conn.Query(ctx, q, database, table)
	if err != nil {
		return nil, PartsSummary{}, fmt.Errorf("querying system.parts: %w", err)
	}
	defer rows.Close()

	var parts []PartDetail
	for rows.Next() {
		var p PartDetail
		if err := rows.Scan(&p.Name, &p.Partition, &p.Rows, &p.Bytes, &p.MarkCount,
			&p.ModTime, &p.AgeSeconds, &p.PrimarySize); err != nil {
			return nil, PartsSummary{}, fmt.Errorf("scanning part: %w", err)
		}
		parts = append(parts, p)
	}
	if err := rows.Err(); err != nil {
		return nil, PartsSummary{}, err
	}

	// Per-partition rollup over ALL active parts (not just the fetched page)
	// so the summary stays truthful when the part list is truncated.
	sumQ := fmt.Sprintf(`
		SELECT partition, count() AS parts, sum(rows), sum(bytes_on_disk)
		FROM %s
		WHERE database = ? AND table = ? AND active
		GROUP BY partition
		ORDER BY parts DESC`, c.tableRef("parts"))
	sumRows, err := c.conn.Query(ctx, sumQ, database, table)
	if err != nil {
		return parts, PartsSummary{}, nil // part list already succeeded
	}
	defer sumRows.Close()

	var total PartsSummary
	var perPartition []PartsPartitionSummary
	for sumRows.Next() {
		var s PartsPartitionSummary
		if err := sumRows.Scan(&s.Partition, &s.Parts, &s.Rows, &s.Bytes); err != nil {
			continue
		}
		total.Parts += s.Parts
		total.Rows += s.Rows
		total.Bytes += s.Bytes
		perPartition = append(perPartition, s)
	}

	summary := PartsSummary{
		Partition:    fmt.Sprintf("%d partitions", len(perPartition)),
		Parts:        total.Parts,
		Rows:         total.Rows,
		Bytes:        total.Bytes,
		PerPartition: perPartition,
	}
	return parts, summary, nil
}
