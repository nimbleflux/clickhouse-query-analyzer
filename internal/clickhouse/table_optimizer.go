package clickhouse

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

func quoteID(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func quoteStr(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

type TableAnalysis struct {
	Database        string           `json:"database"`
	Table           string           `json:"table"`
	Engine          string           `json:"engine"`
	TotalRows       uint64           `json:"total_rows"`
	TotalBytes      uint64           `json:"total_bytes"`
	PartitionKey    string           `json:"partition_key"`
	OrderByKey      string           `json:"order_by_key"`
	PrimaryKey      string           `json:"primary_key"`
	SamplingKey     string           `json:"sampling_key"`
	Columns         []OptColumn      `json:"columns"`
	Parts           []PartInfo       `json:"parts"`
	ExistingIndices []IndexInfo      `json:"existing_indices"`
	Recommendations []Recommendation `json:"recommendations"`
	AnalyzedAt      time.Time        `json:"analyzed_at"`
	Error           string           `json:"error,omitempty"`
}

type OptColumn struct {
	Name             string   `json:"name"`
	Type             string   `json:"type"`
	DefaultKind      string   `json:"default_kind"`
	DefaultExpr      string   `json:"default_expression"`
	IsInPartitionKey bool     `json:"is_in_partition_key"`
	IsInOrderByKey   bool     `json:"is_in_order_by_key"`
	IsInPrimaryKey   bool     `json:"is_in_primary_key"`
	DistinctCount    uint64   `json:"distinct_count,omitempty"`
	TotalSampled     uint64   `json:"total_sampled,omitempty"`
	NullCount        uint64   `json:"null_count,omitempty"`
	MinValue         *string  `json:"min_value,omitempty"`
	MaxValue         *string  `json:"max_value,omitempty"`
	AvgDiff          *float64 `json:"avg_diff,omitempty"`
}

type PartInfo struct {
	Partition  string `json:"partition"`
	PartsCount uint64 `json:"parts_count"`
	Rows       uint64 `json:"rows"`
	Bytes      uint64 `json:"bytes_on_disk"`
}

type IndexInfo struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Expr        string `json:"expr"`
	Granularity uint64 `json:"granularity"`
}

type Recommendation struct {
	Category         string `json:"category"`
	Severity         string `json:"severity"`
	Confidence       string `json:"confidence"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	Current          string `json:"current,omitempty"`
	Suggested        string `json:"suggested,omitempty"`
	Impact           string `json:"impact,omitempty"`
	DDL              string `json:"ddl,omitempty"`
	RequiresRecreate bool   `json:"requires_recreate"`
}

type confidenceCtx struct {
	totalRows    uint64
	totalSampled uint64
	category     string
}

func (ctx confidenceCtx) forCategory(cat string) confidenceCtx {
	ctx.category = cat
	return ctx
}

func (ctx confidenceCtx) withSample(sampled uint64) confidenceCtx {
	ctx.totalSampled = sampled
	return ctx
}

func (ctx confidenceCtx) assess() string {
	switch ctx.category {
	case "data_type":
		if ctx.totalRows < 10_000 || ctx.totalSampled < 1_000 {
			return "low"
		}
		if ctx.totalRows < 1_000_000 || ctx.totalSampled < 10_000 {
			return "medium"
		}
		return "high"
	case "order_by":
		return "low"
	case "partition_by":
		if ctx.totalRows == 0 {
			return "low"
		}
		return "high"
	case "index":
		if ctx.totalRows < 100_000 {
			return "low"
		}
		if ctx.totalRows < 1_000_000 {
			return "medium"
		}
		return "high"
	case "codec":
		if ctx.totalRows < 100_000 || ctx.totalSampled < 10_000 {
			return "low"
		}
		return "medium"
	case "health":
		return "high"
	default:
		return "medium"
	}
}

type BulkProgress struct {
	Current  int    `json:"current"`
	Total    int    `json:"total"`
	Database string `json:"database"`
	Table    string `json:"table"`
}

type BulkDone struct {
	Analyzed int `json:"analyzed"`
	Skipped  int `json:"skipped"`
	Errors   int `json:"errors"`
}

type BulkFilters struct {
	Engine        string `json:"engine,omitempty"`
	MinRows       uint64 `json:"min_rows,omitempty"`
	MinBytes      uint64 `json:"min_bytes,omitempty"`
	ExcludeSystem bool   `json:"exclude_system"`
}

type BulkEvent struct {
	Type     string         `json:"type"`
	Progress *BulkProgress  `json:"progress,omitempty"`
	Result   *TableAnalysis `json:"result,omitempty"`
	Done     *BulkDone      `json:"done,omitempty"`
}

func (c *Client) AnalyzeTable(ctx context.Context, database, table string) (*TableAnalysis, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	analysis := &TableAnalysis{
		Database:   database,
		Table:      table,
		AnalyzedAt: time.Now(),
	}

	if err := c.gatherTableMeta(ctx, analysis); err != nil {
		return nil, fmt.Errorf("gathering table metadata: %w", err)
	}

	if err := c.gatherColumns(ctx, analysis); err != nil {
		return nil, fmt.Errorf("gathering column info: %w", err)
	}

	if err := c.gatherParts(ctx, analysis); err != nil {
		return nil, fmt.Errorf("gathering part info: %w", err)
	}

	if analysis.TotalRows == 0 {
		var rowsFromParts uint64
		for _, p := range analysis.Parts {
			rowsFromParts += p.Rows
		}
		if rowsFromParts > 0 {
			analysis.TotalRows = rowsFromParts
		}
	}

	if err := c.gatherExistingIndices(ctx, analysis); err != nil {
		return nil, fmt.Errorf("gathering indices: %w", err)
	}

	if analysis.TotalRows > 0 {
		if err := c.sampleColumns(ctx, analysis); err != nil {
			return nil, fmt.Errorf("sampling columns: %w", err)
		}
	}

	analysis.Recommendations = c.generateRecommendations(analysis)
	return analysis, nil
}

func (c *Client) ListOptimizableTables(ctx context.Context, database string, filters BulkFilters) ([]TableInfo, error) {
	query := fmt.Sprintf(`
		SELECT name, engine, total_rows
		FROM system.tables
		WHERE database = %s
		  AND engine IN ('MergeTree', 'ReplacingMergeTree', 'SummingMergeTree', 'AggregatingMergeTree', 'CollapsingMergeTree', 'VersionedCollapsingMergeTree', 'GraphiteMergeTree', 'ReplicatedMergeTree', 'ReplicatedReplacingMergeTree', 'ReplicatedSummingMergeTree', 'ReplicatedAggregatingMergeTree', 'ReplicatedCollapsingMergeTree', 'ReplicatedVersionedCollapsingMergeTree')
	`, quoteStr(database))

	if filters.Engine != "" {
		query += fmt.Sprintf(" AND engine = %s", quoteStr(filters.Engine))
	}
	if filters.MinRows > 0 {
		query += fmt.Sprintf(" AND total_rows >= %d", filters.MinRows)
	}

	query += " ORDER BY name"

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("listing tables: %w", err)
	}
	defer rows.Close()

	var tables []TableInfo
	for rows.Next() {
		var name, engine string
		var totalRows uint64
		if err := rows.Scan(&name, &engine, &totalRows); err != nil {
			return nil, err
		}
		tables = append(tables, TableInfo{Name: name, Engine: engine, RowCount: totalRows})
	}
	return tables, nil
}

func (c *Client) StreamBulkAnalysis(ctx context.Context, database string, filters BulkFilters, fn func(BulkEvent)) {
	tables, err := c.ListOptimizableTables(ctx, database, filters)
	if err != nil {
		fn(BulkEvent{Type: "done", Done: &BulkDone{Errors: 1}})
		return
	}

	if len(tables) == 0 {
		fn(BulkEvent{Type: "done", Done: &BulkDone{}})
		return
	}

	analyzed, skipped, errors := 0, 0, 0
	for i, t := range tables {
		select {
		case <-ctx.Done():
			fn(BulkEvent{Type: "done", Done: &BulkDone{Analyzed: analyzed, Skipped: skipped, Errors: errors}})
			return
		default:
		}

		fn(BulkEvent{
			Type: "progress",
			Progress: &BulkProgress{
				Current:  i + 1,
				Total:    len(tables),
				Database: database,
				Table:    t.Name,
			},
		})

		analysis, err := c.AnalyzeTable(ctx, database, t.Name)
		if err != nil {
			errors++
			fn(BulkEvent{
				Type: "result",
				Result: &TableAnalysis{
					Database: database,
					Table:    t.Name,
					Engine:   t.Engine,
					Error:    err.Error(),
				},
			})
		} else {
			analyzed++
			fn(BulkEvent{Type: "result", Result: analysis})
		}

		if i < len(tables)-1 {
			select {
			case <-ctx.Done():
				fn(BulkEvent{Type: "done", Done: &BulkDone{Analyzed: analyzed, Skipped: skipped, Errors: errors}})
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
	}

	fn(BulkEvent{Type: "done", Done: &BulkDone{Analyzed: analyzed, Skipped: skipped, Errors: errors}})
}

func (c *Client) gatherTableMeta(ctx context.Context, a *TableAnalysis) error {
	query := fmt.Sprintf(`
		SELECT
			engine,
			COALESCE(partition_key, ''),
			COALESCE(sorting_key, ''),
			COALESCE(primary_key, ''),
			COALESCE(sampling_key, ''),
			COALESCE(total_rows, 0),
			COALESCE(total_bytes, 0)
		FROM system.tables
		WHERE database = %s AND name = %s
	`, quoteStr(a.Database), quoteStr(a.Table))

	row := c.conn.QueryRow(ctx, query)
	return row.Scan(&a.Engine, &a.PartitionKey, &a.OrderByKey, &a.PrimaryKey, &a.SamplingKey, &a.TotalRows, &a.TotalBytes)
}

func (c *Client) gatherColumns(ctx context.Context, a *TableAnalysis) error {
	rows, err := c.conn.Query(ctx, `
		SELECT name, type, default_kind, default_expression
		FROM system.columns
		WHERE database = ? AND table = ?
		ORDER BY position
	`, a.Database, a.Table)
	if err != nil {
		return err
	}
	defer rows.Close()

	orderCols := splitKey(a.OrderByKey)
	partCols := splitKey(a.PartitionKey)
	pkCols := splitKey(a.PrimaryKey)

	for rows.Next() {
		var name, typ, defKind, defExpr string
		if err := rows.Scan(&name, &typ, &defKind, &defExpr); err != nil {
			return err
		}
		a.Columns = append(a.Columns, OptColumn{
			Name:             name,
			Type:             typ,
			DefaultKind:      defKind,
			DefaultExpr:      defExpr,
			IsInOrderByKey:   contains(orderCols, name),
			IsInPartitionKey: contains(partCols, name),
			IsInPrimaryKey:   contains(pkCols, name),
		})
	}
	return nil
}

func (c *Client) gatherParts(ctx context.Context, a *TableAnalysis) error {
	rows, err := c.conn.Query(ctx, `
		SELECT partition, CAST(count() AS UInt64), sum(rows), sum(bytes_on_disk)
		FROM system.parts
		WHERE database = ? AND table = ? AND active
		GROUP BY partition
		ORDER BY partition
	`, a.Database, a.Table)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var p PartInfo
		if err := rows.Scan(&p.Partition, &p.PartsCount, &p.Rows, &p.Bytes); err != nil {
			return err
		}
		a.Parts = append(a.Parts, p)
	}
	return nil
}

func (c *Client) gatherExistingIndices(ctx context.Context, a *TableAnalysis) error {
	rows, err := c.conn.Query(ctx, `
		SELECT name, type, expr, granularity
		FROM system.data_skipping_indices
		WHERE database = ? AND table = ?
	`, a.Database, a.Table)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var idx IndexInfo
		if err := rows.Scan(&idx.Name, &idx.Type, &idx.Expr, &idx.Granularity); err != nil {
			return err
		}
		a.ExistingIndices = append(a.ExistingIndices, idx)
	}
	return nil
}

func (c *Client) sampleColumns(ctx context.Context, a *TableAnalysis) error {
	sampleClause := sampleClause(a.TotalRows)
	fqn := fmt.Sprintf("%s.%s", quoteID(a.Database), quoteID(a.Table))

	for i := range a.Columns {
		col := &a.Columns[i]
		if col.DefaultKind == "MATERIALIZED" || col.DefaultKind == "ALIAS" {
			continue
		}

		colName := quoteID(col.Name)
		query := fmt.Sprintf(`
			SELECT
				uniqExact(%s),
				count(),
				sum(CAST(isNull(%s) AS UInt64)),
				any(%s),
				any(%s)
			FROM %s %s
		`, colName, colName, fmt.Sprintf("toString(%s)", colName), fmt.Sprintf("toString(%s)", colName), fqn, sampleClause)

		row := c.conn.QueryRow(ctx, query)
		var distinct, total, nullCount uint64
		var minVal, maxVal string
		if err := row.Scan(&distinct, &total, &nullCount, &minVal, &maxVal); err != nil {
			continue
		}
		col.DistinctCount = distinct
		col.TotalSampled = total
		col.NullCount = nullCount
		col.MinValue = &minVal
		col.MaxValue = &maxVal

		if isNumericType(col.Type) && total > 1 && !col.IsInOrderByKey {
			diffQuery := fmt.Sprintf(`
				SELECT avg(abs(%s - lagInFrame(%s) OVER (ORDER BY %s))
			) FROM %s %s LIMIT 10000
			`, colName, colName, colName, fqn, sampleClause)
			var avgDiff float64
			if err := c.conn.QueryRow(ctx, diffQuery).Scan(&avgDiff); err == nil && avgDiff != 0 {
				col.AvgDiff = &avgDiff
			}
		}
	}
	return nil
}

func (c *Client) generateRecommendations(a *TableAnalysis) []Recommendation {
	cc := confidenceCtx{totalRows: a.TotalRows}
	var recs []Recommendation
	if a.TotalRows >= 10_000 {
		recs = append(recs, c.recommendLowCardinality(a, cc)...)
		recs = append(recs, c.recommendIntegerResize(a, cc)...)
		recs = append(recs, c.recommendRemoveNullable(a, cc)...)
	}
	recs = append(recs, c.recommendOrderBy(a, cc)...)
	recs = append(recs, c.recommendPartitionBy(a, cc)...)
	if a.TotalRows >= 100_000 {
		recs = append(recs, c.recommendSkippingIndices(a, cc)...)
		recs = append(recs, c.recommendCodecs(a, cc)...)
	}
	recs = append(recs, c.recommendTableHealth(a, cc)...)
	return recs
}

func (c *Client) recommendLowCardinality(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	catCC := cc.forCategory("data_type")
	for _, col := range a.Columns {
		if col.TotalSampled == 0 || !isStringType(col.Type) {
			continue
		}
		if strings.HasPrefix(col.Type, "LowCardinality") {
			continue
		}
		ratio := float64(col.DistinctCount) / float64(col.TotalSampled)
		if ratio > 0.15 || col.DistinctCount > 10000 {
			continue
		}
		newType := "LowCardinality(" + col.Type + ")"
		estimatedSavings := estimateLowCardSavings(ratio)
		conf := catCC.withSample(col.TotalSampled).assess()
		recs = append(recs, Recommendation{
			Category:    "data_type",
			Severity:    severity(ratio, 0.05, 0.10),
			Confidence:  conf,
			Title:       fmt.Sprintf("Use LowCardinality for %s", col.Name),
			Description: fmt.Sprintf("Column '%s' has %d distinct values out of %d sampled (%.1f%% cardinality). LowCardinality uses dictionary encoding for better compression and faster GROUP BY/IN queries.", col.Name, col.DistinctCount, col.TotalSampled, ratio*100),
			Current:     col.Type,
			Suggested:   newType,
			Impact:      fmt.Sprintf("Reduces storage by ~%s, speeds up GROUP BY and IN operations", estimatedSavings),
			DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s;", a.Database, a.Table, col.Name, newType),
		})
	}
	return recs
}

func (c *Client) recommendIntegerResize(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	catCC := cc.forCategory("data_type")
	for _, col := range a.Columns {
		if col.MinValue == nil || col.MaxValue == nil || !isIntType(col.Type) {
			continue
		}
		minV, maxV, err := parseMinMaxInt(*col.MinValue, *col.MaxValue)
		if err != nil {
			continue
		}
		suggested := suggestIntType(minV, maxV)
		if suggested == "" || suggested == stripNullable(col.Type) {
			continue
		}
		nullable := strings.HasPrefix(col.Type, "Nullable(")
		newType := suggested
		if nullable {
			newType = "Nullable(" + suggested + ")"
		}
		conf := catCC.withSample(col.TotalSampled).assess()
		recs = append(recs, Recommendation{
			Category:    "data_type",
			Severity:    "medium",
			Confidence:  conf,
			Title:       fmt.Sprintf("Downsize %s from %s to %s", col.Name, col.Type, newType),
			Description: fmt.Sprintf("Column '%s' range [%s, %s] fits in %s. Using a smaller type reduces memory and storage.", col.Name, *col.MinValue, *col.MaxValue, suggested),
			Current:     col.Type,
			Suggested:   newType,
			Impact:      fmt.Sprintf("Reduces column size from %d bytes to %d bytes per value", intTypeSize(stripNullable(col.Type)), intTypeSize(suggested)),
			DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s;", a.Database, a.Table, col.Name, newType),
		})
	}
	return recs
}

func (c *Client) recommendRemoveNullable(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	catCC := cc.forCategory("data_type")
	for _, col := range a.Columns {
		if !strings.HasPrefix(col.Type, "Nullable(") {
			continue
		}
		if col.TotalSampled == 0 {
			continue
		}
		if col.NullCount > 0 {
			continue
		}
		inner := strings.TrimSuffix(strings.TrimPrefix(col.Type, "Nullable("), ")")
		conf := catCC.withSample(col.TotalSampled).assess()
		recs = append(recs, Recommendation{
			Category:    "data_type",
			Severity:    "low",
			Confidence:  conf,
			Title:       fmt.Sprintf("Remove Nullable from %s", col.Name),
			Description: fmt.Sprintf("Column '%s' is Nullable(%s) but has 0 null values in the sample. Removing Nullable avoids the extra null bitmap and improves performance.", col.Name, inner),
			Current:     col.Type,
			Suggested:   inner,
			Impact:      "Eliminates null bitmap overhead, improves scan performance",
			DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s;", a.Database, a.Table, col.Name, inner),
		})
	}
	return recs
}

func (c *Client) recommendOrderBy(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	if a.OrderByKey != "" {
		return recs
	}

	conf := cc.forCategory("order_by").assess()

	var candidates []struct {
		name     string
		typeStr  string
		distinct uint64
	}
	for _, col := range a.Columns {
		if col.DefaultKind == "MATERIALIZED" || col.DefaultKind == "ALIAS" {
			continue
		}
		if col.DistinctCount > 0 {
			candidates = append(candidates, struct {
				name     string
				typeStr  string
				distinct uint64
			}{col.Name, col.Type, col.DistinctCount})
		}
	}

	if len(candidates) == 0 {
		recs = append(recs, Recommendation{
			Category:         "order_by",
			Severity:         "high",
			Confidence:       conf,
			Title:            "Add ORDER BY key",
			Description:      "Table has no ORDER BY defined. Without it, data is stored in insertion order which prevents compression and makes queries slower.",
			Impact:           "Enables proper data compression and efficient range scans",
			RequiresRecreate: true,
		})
		return recs
	}

	limit := len(candidates)
	if limit > 4 {
		limit = 4
	}

	var orderCols []string
	for _, c2 := range candidates[:limit] {
		orderCols = append(orderCols, fmt.Sprintf("`%s`", c2.name))
	}

	suggested := strings.Join(orderCols, ", ")
	recs = append(recs, Recommendation{
		Category:         "order_by",
		Severity:         "high",
		Confidence:       conf,
		Title:            "Add ORDER BY key",
		Description:      fmt.Sprintf("Table has no ORDER BY. Suggested ORDER BY based on column cardinality (lowest first for best compression): %s", suggested),
		Current:          "(none)",
		Suggested:        suggested,
		Impact:           "Enables proper data compression and efficient range scans",
		DDL:              fmt.Sprintf("-- Requires table recreation:\n-- CREATE TABLE `%s`.`%s` ... ORDER BY (%s);", a.Database, a.Table, suggested),
		RequiresRecreate: true,
	})
	return recs
}

func (c *Client) recommendPartitionBy(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation

	if a.PartitionKey == "" {
		for _, col := range a.Columns {
			if isDateOrDateTimeType(col.Type) && !col.IsInOrderByKey {
				expr := fmt.Sprintf("toYYYYMM(`%s`)", col.Name)
				conf := cc.forCategory("partition_by").withSample(col.TotalSampled).assess()
				recs = append(recs, Recommendation{
					Category:         "partition_by",
					Severity:         "medium",
					Confidence:       conf,
					Title:            fmt.Sprintf("Add PARTITION BY on %s", col.Name),
					Description:      fmt.Sprintf("Table is not partitioned. Column '%s' is a temporal type — monthly partitioning would enable efficient partition pruning and data lifecycle management.", col.Name),
					Current:          "(none)",
					Suggested:        expr,
					Impact:           "Enables partition pruning for date-filtered queries, supports efficient DROP PARTITION for data retention",
					DDL:              fmt.Sprintf("-- Requires table recreation:\n-- CREATE TABLE `%s`.`%s` ... PARTITION BY %s;", a.Database, a.Table, expr),
					RequiresRecreate: true,
				})
				break
			}
		}
	}

	totalParts := uint64(0)
	var totalBytes uint64
	var maxPartBytes uint64
	var maxPartName string
	for _, p := range a.Parts {
		totalParts += p.PartsCount
		totalBytes += p.Bytes
		if p.Bytes > maxPartBytes {
			maxPartBytes = p.Bytes
			maxPartName = p.Partition
		}
	}

	if totalParts > 100 {
		recs = append(recs, Recommendation{
			Category:    "health",
			Severity:    "medium",
			Confidence:  cc.forCategory("health").assess(),
			Title:       "Too many unmerged parts",
			Description: fmt.Sprintf("Table has %d active parts across %d partitions. Excessive parts degrade query performance and increase background merge overhead.", totalParts, len(a.Parts)),
			Current:     fmt.Sprintf("%d parts", totalParts),
			Suggested:   "< 100 parts",
			Impact:      "Reduces merge overhead and improves query planning",
			DDL:         fmt.Sprintf("OPTIMIZE TABLE `%s`.`%s` FINAL;", a.Database, a.Table),
		})
	}

	if len(a.Parts) > 1 && totalBytes > 0 {
		avgPartBytes := totalBytes / uint64(len(a.Parts))
		for _, p := range a.Parts {
			if p.Bytes > avgPartBytes*10 && avgPartBytes > 0 {
				recs = append(recs, Recommendation{
					Category:    "partition_by",
					Severity:    "low",
					Confidence:  cc.forCategory("partition_by").assess(),
					Title:       fmt.Sprintf("Partition skew detected on partition %s", p.Partition),
					Description: fmt.Sprintf("Partition '%s' is %.1fx larger than the average partition (%s vs avg %s). Consider a more granular partition key.", p.Partition, float64(p.Bytes)/float64(avgPartBytes), formatBytes(p.Bytes), formatBytes(avgPartBytes)),
					Current:     a.PartitionKey,
					Impact:      "More balanced partitions improve parallel scan efficiency",
				})
				break
			}
		}
	}

	if maxPartBytes > 10*1024*1024*1024 && a.PartitionKey != "" {
		recs = append(recs, Recommendation{
			Category:         "partition_by",
			Severity:         "medium",
			Confidence:       cc.forCategory("partition_by").assess(),
			Title:            fmt.Sprintf("Large partition: %s (%s)", maxPartName, formatBytes(maxPartBytes)),
			Description:      fmt.Sprintf("Partition '%s' exceeds 10GB. Consider a more granular partition key to improve partition pruning and data management.", maxPartName),
			Current:          a.PartitionKey,
			Impact:           "Smaller partitions improve drop/truncate operations and partition pruning",
			RequiresRecreate: true,
		})
	}

	return recs
}

func (c *Client) recommendSkippingIndices(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	existingIdxCols := make(map[string]bool)
	for _, idx := range a.ExistingIndices {
		existingIdxCols[idx.Expr] = true
	}

	for _, col := range a.Columns {
		if col.IsInOrderByKey || col.IsInPrimaryKey {
			continue
		}
		if col.DefaultKind == "MATERIALIZED" || col.DefaultKind == "ALIAS" {
			continue
		}
		if col.TotalSampled == 0 {
			continue
		}
		colExpr := fmt.Sprintf("`%s`", col.Name)
		if existingIdxCols[colExpr] {
			continue
		}

		idxName := fmt.Sprintf("idx_%s", col.Name)
		conf := cc.forCategory("index").withSample(col.TotalSampled).assess()

		if isStringType(col.Type) {
			ratio := float64(col.DistinctCount) / float64(col.TotalSampled)
			if ratio > 0.5 && col.DistinctCount > 100 {
				recs = append(recs, Recommendation{
					Category:    "index",
					Severity:    "medium",
					Confidence:  conf,
					Title:       fmt.Sprintf("Add bloom filter index on %s", col.Name),
					Description: fmt.Sprintf("Column '%s' has high cardinality (%d distinct). A token bloom filter index accelerates equality and LIKE lookups.", col.Name, col.DistinctCount),
					Current:     "(none)",
					Suggested:   fmt.Sprintf("bloom_filter(%s)", colExpr),
					Impact:      "Speeds up WHERE col = ... and WHERE col LIKE ... queries by skipping granules",
					DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` ADD INDEX %s bloom_filter(%s) TYPE bloom_filter GRANULARITY 4;", a.Database, a.Table, idxName, colExpr),
				})
			}
		} else if isNumericType(col.Type) {
			recs = append(recs, Recommendation{
				Category:    "index",
				Severity:    "low",
				Confidence:  conf,
				Title:       fmt.Sprintf("Add min-max index on %s", col.Name),
				Description: fmt.Sprintf("Column '%s' is not in the ORDER BY key. A min-max skipping index helps prune granules for range queries.", col.Name),
				Current:     "(none)",
				Suggested:   fmt.Sprintf("minmax(%s)", colExpr),
				Impact:      "Speeds up WHERE col > ... and WHERE col BETWEEN ... queries",
				DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` ADD INDEX %s minmax(%s) TYPE minmax GRANULARITY 4;", a.Database, a.Table, idxName, colExpr),
			})
		}
	}
	return recs
}

func (c *Client) recommendCodecs(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	for _, col := range a.Columns {
		if strings.Contains(col.Type, "Codec(") {
			continue
		}
		if col.DefaultKind == "MATERIALIZED" || col.DefaultKind == "ALIAS" {
			continue
		}

		conf := cc.forCategory("codec").withSample(col.TotalSampled).assess()

		if isDateOrDateTimeType(col.Type) {
			if col.AvgDiff != nil && *col.AvgDiff > 0 && *col.AvgDiff < 1000 {
				recs = append(recs, Recommendation{
					Category:    "codec",
					Severity:    "low",
					Confidence:  conf,
					Title:       fmt.Sprintf("Add DoubleDelta codec for %s", col.Name),
					Description: fmt.Sprintf("Column '%s' is a temporal type with sequential values (avg diff: %.1f). DoubleDelta codec provides excellent compression for monotonic sequences.", col.Name, *col.AvgDiff),
					Current:     col.Type,
					Suggested:   col.Type + " CODEC(DoubleDelta, LZ4)",
					Impact:      "Can reduce storage by 90%+ for timestamp columns",
					DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s CODEC(DoubleDelta, LZ4);", a.Database, a.Table, col.Name, col.Type),
				})
			} else {
				recs = append(recs, Recommendation{
					Category:    "codec",
					Severity:    "low",
					Confidence:  conf,
					Title:       fmt.Sprintf("Add Gorilla codec for %s", col.Name),
					Description: fmt.Sprintf("Column '%s' is a temporal type. Gorilla codec is efficient for timestamp data.", col.Name),
					Current:     col.Type,
					Suggested:   col.Type + " CODEC(Gorilla, LZ4)",
					Impact:      "Reduces storage for timestamp/time-series data",
					DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s CODEC(Gorilla, LZ4);", a.Database, a.Table, col.Name, col.Type),
				})
			}
			continue
		}

		if isIntType(col.Type) && col.AvgDiff != nil && *col.AvgDiff > 0 && *col.AvgDiff < 100 {
			recs = append(recs, Recommendation{
				Category:    "codec",
				Severity:    "low",
				Confidence:  conf,
				Title:       fmt.Sprintf("Add Delta codec for %s", col.Name),
				Description: fmt.Sprintf("Column '%s' has near-sequential values (avg diff: %.1f). Delta codec compresses small differences efficiently.", col.Name, *col.AvgDiff),
				Current:     col.Type,
				Suggested:   col.Type + " CODEC(Delta, LZ4)",
				Impact:      "Reduces storage for sequential integer columns",
				DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s CODEC(Delta, LZ4);", a.Database, a.Table, col.Name, col.Type),
			})
			continue
		}

		if isStringType(col.Type) && col.TotalSampled > 0 {
			ratio := float64(col.DistinctCount) / float64(col.TotalSampled)
			if ratio > 0.8 {
				recs = append(recs, Recommendation{
					Category:    "codec",
					Severity:    "low",
					Confidence:  conf,
					Title:       fmt.Sprintf("Add ZSTD codec for %s", col.Name),
					Description: fmt.Sprintf("Column '%s' has high cardinality (%.0f%%). ZSTD codec provides better compression for high-entropy string data.", col.Name, ratio*100),
					Current:     col.Type,
					Suggested:   col.Type + " CODEC(ZSTD(3))",
					Impact:      "Improves compression ratio for high-cardinality strings",
					DDL:         fmt.Sprintf("ALTER TABLE `%s`.`%s` MODIFY COLUMN `%s` %s CODEC(ZSTD(3));", a.Database, a.Table, col.Name, col.Type),
				})
			}
		}
	}
	return recs
}

func (c *Client) recommendTableHealth(a *TableAnalysis, cc confidenceCtx) []Recommendation {
	var recs []Recommendation
	conf := cc.forCategory("health").assess()

	if a.TotalRows == 0 {
		return recs
	}

	if len(a.Parts) == 0 {
		recs = append(recs, Recommendation{
			Category:    "health",
			Severity:    "high",
			Confidence:  conf,
			Title:       "No active parts found",
			Description: "Table has no active data parts. It may have been truncated or data is still inserting.",
			Impact:      "Table may be empty or in an inconsistent state",
		})
		return recs
	}

	bytesPerRow := float64(a.TotalBytes) / float64(a.TotalRows)
	if bytesPerRow > 10000 {
		recs = append(recs, Recommendation{
			Category:    "health",
			Severity:    "medium",
			Confidence:  conf,
			Title:       "High bytes-per-row ratio",
			Description: fmt.Sprintf("Table averages %.0f bytes per row. This may indicate wide columns, inefficient types, or missing compression.", bytesPerRow),
			Current:     fmt.Sprintf("%.0f bytes/row", bytesPerRow),
			Suggested:   "< 1000 bytes/row typical",
			Impact:      "Review column types and apply LowCardinality/codec recommendations above",
		})
	}

	return recs
}

func sampleClause(totalRows uint64) string {
	if totalRows < 100_000 {
		return ""
	}
	if totalRows < 10_000_000 {
		return "SAMPLE 0.01"
	}
	return "SAMPLE 0.001"
}

func splitKey(key string) []string {
	if key == "" {
		return nil
	}
	parts := strings.Split(key, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, "` ")
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func isStringType(t string) bool {
	t = stripNullable(t)
	return strings.HasPrefix(t, "String") || strings.HasPrefix(t, "FixedString") ||
		strings.HasPrefix(t, "UUID") || strings.HasPrefix(t, "Enum")
}

func isIntType(t string) bool {
	t = stripNullable(t)
	return strings.HasPrefix(t, "Int8") || strings.HasPrefix(t, "Int16") ||
		strings.HasPrefix(t, "Int32") || strings.HasPrefix(t, "Int64") ||
		strings.HasPrefix(t, "UInt8") || strings.HasPrefix(t, "UInt16") ||
		strings.HasPrefix(t, "UInt32") || strings.HasPrefix(t, "UInt64") ||
		strings.HasPrefix(t, "Int128") || strings.HasPrefix(t, "Int256") ||
		strings.HasPrefix(t, "UInt128") || strings.HasPrefix(t, "UInt256")
}

func isNumericType(t string) bool {
	return isIntType(t) || strings.HasPrefix(stripNullable(t), "Float")
}

func isDateOrDateTimeType(t string) bool {
	t = stripNullable(t)
	return strings.HasPrefix(t, "Date") || strings.HasPrefix(t, "DateTime")
}

func stripNullable(t string) string {
	if strings.HasPrefix(t, "Nullable(") {
		return strings.TrimSuffix(strings.TrimPrefix(t, "Nullable("), ")")
	}
	return t
}

func parseMinMaxInt(minStr, maxStr string) (int64, int64, error) {
	var minV, maxV int64
	if _, err := fmt.Sscanf(minStr, "%d", &minV); err != nil {
		return 0, 0, err
	}
	if _, err := fmt.Sscanf(maxStr, "%d", &maxV); err != nil {
		return 0, 0, err
	}
	return minV, maxV, nil
}

func suggestIntType(minV, maxV int64) string {
	if minV >= 0 {
		return suggestUIntType(uint64(minV), uint64(maxV))
	}
	if minV >= math.MinInt8 && maxV <= math.MaxInt8 {
		return "Int8"
	}
	if minV >= math.MinInt16 && maxV <= math.MaxInt16 {
		return "Int16"
	}
	if minV >= math.MinInt32 && maxV <= math.MaxInt32 {
		return "Int32"
	}
	return ""
}

func suggestUIntType(minV, maxV uint64) string {
	if maxV <= math.MaxUint8 {
		return "UInt8"
	}
	if maxV <= math.MaxUint16 {
		return "UInt16"
	}
	if maxV <= math.MaxUint32 {
		return "UInt32"
	}
	return ""
}

func intTypeSize(t string) int {
	switch t {
	case "Int8", "UInt8":
		return 1
	case "Int16", "UInt16":
		return 2
	case "Int32", "UInt32":
		return 4
	case "Int64", "UInt64":
		return 8
	case "Int128", "UInt128":
		return 16
	case "Int256", "UInt256":
		return 32
	default:
		return 8
	}
}

func severity(ratio float64, high, medium float64) string {
	if ratio < high {
		return "high"
	}
	if ratio < medium {
		return "medium"
	}
	return "low"
}

func estimateLowCardSavings(ratio float64) string {
	if ratio < 0.01 {
		return "90-95%"
	}
	if ratio < 0.05 {
		return "70-85%"
	}
	return "40-60%"
}

func formatBytes(b uint64) string {
	if b < 1024 {
		return fmt.Sprintf("%d B", b)
	}
	if b < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(b)/1024)
	}
	if b < 1024*1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(b)/(1024*1024))
	}
	if b < 1024*1024*1024*1024 {
		return fmt.Sprintf("%.1f GB", float64(b)/(1024*1024*1024))
	}
	return fmt.Sprintf("%.1f TB", float64(b)/(1024*1024*1024*1024))
}

var _ driver.Conn = nil
