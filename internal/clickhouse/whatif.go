package clickhouse

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// minWhatIfVersion is the ClickHouse release that introduced hypothetical
// skip indexes and EXPLAIN WHATIF (26.6).
const minWhatIfVersion = "26.6"

// IndexValidation is the measured answer to "would this suggested skipping
// index actually prune anything?". Produced with session-scoped hypothetical
// indexes + EXPLAIN WHATIF on ClickHouse ≥ 26.6; unavailable on older
// servers, where recommendations stay heuristic-only.
type IndexValidation struct {
	Available bool   `json:"available"`
	Note      string `json:"note,omitempty"`
	// applicable | not_applicable (from the WHATIF report)
	Applicable string `json:"applicable,omitempty"`
	// Baseline = after primary key + partitioning + existing indexes.
	MarksBefore    uint64  `json:"marks_before,omitempty"`
	MarksAfter     uint64  `json:"marks_after,omitempty"`
	SkipRatioPct   float64 `json:"skip_ratio_pct,omitempty"`
	EstBytesBefore string  `json:"est_bytes_before,omitempty"`
	EstBytesAfter  string  `json:"est_bytes_after,omitempty"`
}

var (
	whatifStatusRe    = regexp.MustCompile(`(?m)^\s*status:\s*(\w+)`)
	whatifSkipRatioRe = regexp.MustCompile(`skip_ratio:\s*([\d.]+)\s*%`)
	whatifMarksRe     = regexp.MustCompile(`(?m)^\s*marks:\s*(\d+)`)
	whatifEstBytesRe  = regexp.MustCompile(`(?m)^\s*est_bytes:\s*(\S+)`)
)

// sampleLiteral picks a predicate value for the WHATIF probe query from the
// column's sampled statistics. The estimate is only as representative as
// this literal — the UI labels it as a sample predicate.
func sampleLiteral(v *ValidationSample) string {
	if v == nil || v.Value == "" {
		return "0"
	}
	if v.Quoted {
		return quoteStr(v.Value)
	}
	return v.Value
}

// ValidationSample carries a representative value for the probe predicate.
type ValidationSample struct {
	Value  string
	Quoted bool
}

// SampleForColumn derives a probe predicate value from the analysis data:
// numeric columns use their sampled minimum; everything else uses a short
// string literal (bloom filters prune on equality regardless of the value).
func SampleForColumn(a *TableAnalysis, colName string) *ValidationSample {
	for _, col := range a.Columns {
		if col.Name != colName {
			continue
		}
		if col.MinValue != nil && *col.MinValue != "" && isNumericType(col.Type) {
			if _, err := strconv.ParseFloat(*col.MinValue, 64); err == nil {
				return &ValidationSample{Value: *col.MinValue}
			}
		}
		if isStringType(col.Type) {
			return &ValidationSample{Value: "clicklens-probe", Quoted: true}
		}
		break
	}
	return &ValidationSample{Value: "0"}
}

// ValidateIndexSuggestion measures one suggested skipping index with a
// session-scoped hypothetical index and EXPLAIN WHATIF. Returns Available=false
// (with a note) on pre-26.6 servers or when the probe fails — validation is
// best-effort and never blocks the recommendation itself.
func (c *Client) ValidateIndexSuggestion(ctx context.Context, database, table, column, indexType string, granularity uint64, sample *ValidationSample) *IndexValidation {
	unavailable := func(note string) *IndexValidation {
		return &IndexValidation{Available: false, Note: note}
	}
	if c.Version() == "" {
		return unavailable("Server version unknown — skipping index validation.")
	}
	if compareVersions(c.Version(), minWhatIfVersion) < 0 {
		return unavailable(fmt.Sprintf("Requires ClickHouse %s+ (this server is %s).", minWhatIfVersion, c.Version()))
	}

	idxName := fmt.Sprintf("clicklens_whatif_%s", strings.ReplaceAll(column, "`", ""))
	create := fmt.Sprintf(
		"CREATE HYPOTHETICAL INDEX %s ON %s.%s (%s) TYPE %s GRANULARITY %d",
		quoteIdent(idxName), quoteIdent(database), quoteIdent(table), quoteIdent(column), indexType, granularity)
	if err := c.conn.Exec(ctx, create); err != nil {
		// A leftover hypothetical index from an earlier probe on the same
		// pooled connection: drop and retry once.
		if err2 := c.conn.Exec(ctx, fmt.Sprintf("DROP INDEX IF EXISTS %s.%s.%s", quoteIdent(database), quoteIdent(table), quoteIdent(idxName))); err2 == nil {
			if err3 := c.conn.Exec(ctx, create); err3 != nil {
				return unavailable(fmt.Sprintf("Hypothetical index probe failed: %v", err3))
			}
		} else {
			return unavailable(fmt.Sprintf("Hypothetical index probe failed: %v", err))
		}
	}
	defer func() {
		// Hypothetical indexes are session-scoped; drop it so the pooled
		// connection doesn't accumulate probe artifacts. Best-effort.
		_ = c.conn.Exec(context.WithoutCancel(ctx),
			fmt.Sprintf("DROP INDEX IF EXISTS %s.%s.%s", quoteIdent(database), quoteIdent(table), quoteIdent(idxName)))
	}()

	probe := fmt.Sprintf(
		"EXPLAIN WHATIF SELECT 1 FROM %s.%s WHERE %s = %s",
		quoteIdent(database), quoteIdent(table), quoteIdent(column), sampleLiteral(sample))

	rows, err := c.conn.Query(ctx, probe)
	if err != nil {
		return unavailable(fmt.Sprintf("EXPLAIN WHATIF failed: %v", err))
	}
	defer rows.Close()
	var sb strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return unavailable(fmt.Sprintf("EXPLAIN WHATIF failed: %v", err))
		}
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		return unavailable(fmt.Sprintf("EXPLAIN WHATIF failed: %v", err))
	}
	return parseWhatIfReport(sb.String())
}

// parseWhatIfReport extracts the numbers from the EXPLAIN WHATIF text report:
// a baseline block (marks/est_bytes after PK + partition + existing indexes)
// and a per-candidate block (status, marks, est_bytes, skip_ratio).
func parseWhatIfReport(report string) *IndexValidation {
	v := &IndexValidation{Available: true}

	if m := whatifStatusRe.FindStringSubmatch(report); m != nil {
		v.Applicable = m[1]
	}
	if m := whatifSkipRatioRe.FindStringSubmatch(report); m != nil {
		if pct, err := strconv.ParseFloat(m[1], 64); err == nil {
			v.SkipRatioPct = pct
		}
	}
	if marks := whatifMarksRe.FindAllStringSubmatch(report, -1); len(marks) > 0 {
		// First occurrence = baseline, second = with the candidate index.
		if n, err := strconv.ParseUint(marks[0][1], 10, 64); err == nil {
			v.MarksBefore = n
		}
		if len(marks) > 1 {
			if n, err := strconv.ParseUint(marks[1][1], 10, 64); err == nil {
				v.MarksAfter = n
			}
		}
	}
	if bytes := whatifEstBytesRe.FindAllStringSubmatch(report, -1); len(bytes) > 0 {
		v.EstBytesBefore = bytes[0][1]
		if len(bytes) > 1 {
			v.EstBytesAfter = bytes[1][1]
		}
	}
	return v
}
