package clickhouse

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type ExplainResult struct {
	Plan          string            `json:"plan,omitempty"`
	Pipeline      string            `json:"pipeline,omitempty"`
	PipelineGraph string            `json:"pipeline_graph,omitempty"`
	Syntax        string            `json:"syntax,omitempty"`
	Estimate      *ExplainEstimate  `json:"estimate,omitempty"`
	Errors        map[string]string `json:"errors,omitempty"`
}

type ExplainEstimate struct {
	Rows   uint64 `json:"rows"`
	Blocks uint64 `json:"blocks,omitempty"` // removed in ClickHouse 26.7; 0 on newer servers
	Bytes  uint64 `json:"bytes,omitempty"`  // removed in ClickHouse 26.7; 0 on newer servers
	Parts  uint64 `json:"parts"`
	Marks  uint64 `json:"marks"`
	Raw    string `json:"raw,omitempty"`
}

func (c *Client) GetExplain(ctx context.Context, query string) (*ExplainResult, error) {
	// EXPLAIN PLAN/PIPELINE/ESTIMATE only parse SELECT-like statements.
	// Running them on DDL/DML produces five SYNTAX_ERRORs in the ClickHouse
	// log per view, so short-circuit before touching the connection.
	if !isSelectLike(query) {
		return &ExplainResult{
			Errors: map[string]string{
				"skipped": "EXPLAIN only applies to SELECT-like queries; this query is not explainable",
			},
		}, nil
	}

	result := &ExplainResult{Errors: map[string]string{}}

	plan, err := c.runExplain(ctx, "EXPLAIN PLAN", query)
	if err == nil {
		result.Plan = plan
	} else {
		result.Errors["plan"] = err.Error()
	}

	pipeline, err := c.runExplain(ctx, "EXPLAIN PIPELINE", query)
	if err == nil {
		result.Pipeline = pipeline
	} else {
		result.Errors["pipeline"] = err.Error()
	}

	pipelineGraph, err := c.runExplain(ctx, "EXPLAIN PIPELINE graph=1", query)
	if err == nil {
		result.PipelineGraph = pipelineGraph
	} else {
		result.Errors["pipeline_graph"] = err.Error()
	}

	syntax, err := c.runExplain(ctx, "EXPLAIN SYNTAX", query)
	if err == nil {
		result.Syntax = syntax
	} else {
		result.Errors["syntax"] = err.Error()
	}

	estimate, err := c.runExplainEstimate(ctx, query)
	if err == nil && estimate != nil {
		result.Estimate = estimate
	} else if err != nil {
		result.Errors["estimate"] = err.Error()
	}

	if len(result.Errors) == 0 {
		result.Errors = nil
	}
	return result, nil
}

func (c *Client) runExplain(ctx context.Context, explainType, query string) (string, error) {
	explainQuery := fmt.Sprintf("%s %s", explainType, query)

	rows, err := c.conn.Query(ctx, explainQuery)
	if err != nil {
		return "", fmt.Errorf("running %s: %w", explainType, err)
	}
	defer rows.Close()

	var result string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return "", fmt.Errorf("scanning explain row: %w", err)
		}
		if result != "" {
			result += "\n"
		}
		result += line
	}
	return result, nil
}

func (c *Client) runExplainEstimate(ctx context.Context, query string) (*ExplainEstimate, error) {
	rows, err := c.conn.Query(ctx, fmt.Sprintf("EXPLAIN ESTIMATE %s", query))
	if err != nil {
		return nil, fmt.Errorf("running EXPLAIN ESTIMATE: %w", err)
	}
	defer rows.Close()

	// EXPLAIN ESTIMATE's column layout changed across ClickHouse versions:
	//   pre-26.7: one string column "rows blocks bytes parts marks"
	//   26.7+:    five named columns database,table,parts,rows,marks
	// (blocks and bytes are no longer estimated.) Detect the arity once so we
	// can scan either shape without a per-row Scan error.
	cols := rows.Columns()

	estimate := &ExplainEstimate{}
	switch len(cols) {
	case 1:
		// Legacy single-column text format.
		var lines []string
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				return nil, fmt.Errorf("scanning EXPLAIN ESTIMATE row: %w", err)
			}
			lines = append(lines, line)
		}
		if len(lines) == 0 {
			return nil, nil
		}
		estimate.Raw = strings.Join(lines, "\n")
		for _, line := range lines {
			if parsed := parseEstimateLine(line); parsed != nil {
				estimate.Rows += parsed.Rows
				estimate.Blocks += parsed.Blocks
				estimate.Bytes += parsed.Bytes
				estimate.Parts += parsed.Parts
				estimate.Marks += parsed.Marks
			}
		}
	default:
		// 26.7+ multi-column format: database, table, parts, rows, marks.
		// Scan into 5 string slots and parse by column name so column order
		// doesn't matter (the driver returns Scan with len(dest)==len(cols)).
		for rows.Next() {
			vals := make(map[string]string, len(cols))
			scanners := make([]any, len(cols))
			ptrs := make([]sql.NullString, len(cols))
			for i := range cols {
				scanners[i] = &ptrs[i]
			}
			if err := rows.Scan(scanners...); err != nil {
				return nil, fmt.Errorf("scanning EXPLAIN ESTIMATE row: %w", err)
			}
			for i, name := range cols {
				if ptrs[i].Valid {
					vals[name] = ptrs[i].String
				}
			}
			estimate.Parts += parseUintOrZero(vals["parts"])
			estimate.Rows += parseUintOrZero(vals["rows"])
			estimate.Marks += parseUintOrZero(vals["marks"])
		}
		// Rebuild a raw text view for the "Raw EXPLAIN text" details pane so
		// the format is still inspectable in the UI.
		estimate.Raw = fmt.Sprintf("parts\trows\tmarks\n%d\t%d\t%d",
			estimate.Parts, estimate.Rows, estimate.Marks)
	}
	return estimate, nil
}

// parseUintOrZero parses a base-10 uint64, returning 0 on any error (e.g.
// missing or non-numeric column value from EXPLAIN ESTIMATE).
func parseUintOrZero(s string) uint64 {
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

func parseEstimateLine(line string) *ExplainEstimate {
	parts := strings.Fields(line)
	if len(parts) < 5 {
		return nil
	}
	e := &ExplainEstimate{}
	var err error
	if e.Rows, err = strconv.ParseUint(parts[0], 10, 64); err != nil {
		return nil
	}
	if e.Blocks, err = strconv.ParseUint(parts[1], 10, 64); err != nil {
		return nil
	}
	if e.Bytes, err = strconv.ParseUint(parts[2], 10, 64); err != nil {
		return nil
	}
	if e.Parts, err = strconv.ParseUint(parts[3], 10, 64); err != nil {
		return nil
	}
	if e.Marks, err = strconv.ParseUint(parts[4], 10, 64); err != nil {
		return nil
	}
	return e
}

// ExplainAnalyze holds the output of EXPLAIN ANALYZE, which executes the
// query and annotates the plan with measured runtime metrics. Available in
// ClickHouse 26.7+. Unlike the planner-only variants above, this one
// re-runs the underlying query, so callers must guard against non-SELECT
// payloads (see GetExplainAnalyze).
type ExplainAnalyze struct {
	Raw     string                `json:"raw"`
	Summary ExplainAnalyzeSummary `json:"summary"`
	Errors  map[string]string     `json:"errors,omitempty"`
}

// ExplainAnalyzeSummary captures the high-level metrics from the "Query
// summary" block at the top of the ANALYZE output. Parsing is best-effort:
// any field that cannot be matched stays zero-valued.
type ExplainAnalyzeSummary struct {
	TotalMs     float64 `json:"total_ms,omitempty"`
	PlanningMs  float64 `json:"planning_ms,omitempty"`
	ExecutionMs float64 `json:"execution_ms,omitempty"`
	ReadRows    uint64  `json:"read_rows,omitempty"`
	ReadBytes   uint64  `json:"read_bytes,omitempty"`
	RowsPerSec  float64 `json:"rows_per_sec,omitempty"`
	BytesPerSec float64 `json:"bytes_per_sec,omitempty"`
	PeakMemory  uint64  `json:"peak_memory,omitempty"`
}

// minExplainAnalyzeVersion is the first ClickHouse release that ships the
// re-introduced EXPLAIN ANALYZE (PR #110668). On older servers ANALYZE is not
// a recognised EXPLAIN kind, so issuing it produces a SYNTAX_ERROR and the
// word "analyze" never appears in the message — we therefore gate on version
// rather than trying to infer support from the error text.
const minExplainAnalyzeVersion = "26.7"

// GetExplainAnalyze runs EXPLAIN ANALYZE against the query. Unlike the
// planner-only variants, this re-executes the query on the server to gather
// real runtime metrics. It is therefore deliberately NOT part of GetExplain
// (which runs on every Explain-tab open) and must be triggered explicitly.
//
// The isSelectLike guard is the primary safety barrier: INSERT/CREATE/DROP
// never start with SELECT/WITH, so ANALYZE is only ever attempted on reads.
func (c *Client) GetExplainAnalyze(ctx context.Context, query string, processors bool) (*ExplainAnalyze, error) {
	if !isSelectLike(query) {
		return &ExplainAnalyze{
			Errors: map[string]string{
				"skipped": "EXPLAIN ANALYZE only applies to SELECT-like queries; this query is not explainable",
			},
		}, nil
	}

	// Gate on the cached server version before issuing the query. On pre-26.7
	// builds EXPLAIN ANALYZE is a syntax error; checking first avoids polluting
	// the server error log on every click and lets us return a clear message.
	if supported, why, err := c.supportsExplainAnalyze(); err != nil {
		return nil, err
	} else if !supported {
		return &ExplainAnalyze{Errors: map[string]string{"unsupported": why}}, nil
	}

	processorsClause := ""
	if processors {
		processorsClause = " processors = 1"
	}
	// runExplain builds "%s %s" from (explainType, query); passing the full
	// "EXPLAIN ANALYZE processors = 1" prefix yields the correct statement.
	raw, err := c.runExplain(ctx, "EXPLAIN ANALYZE"+processorsClause, query)
	if err != nil {
		return nil, err
	}

	return &ExplainAnalyze{
		Raw:     raw,
		Summary: parseAnalyzeSummary(raw),
	}, nil
}

// supportsExplainAnalyze checks the cached server version against the minimum
// that ships EXPLAIN ANALYZE. The version is detected once at connect time
// (see detectVersion), so this does no server round-trip. Returns (ok,
// message); on ok==true the message is empty, on ok==false it is a
// user-facing explanation naming the detected version.
func (c *Client) supportsExplainAnalyze() (bool, string, error) {
	if c.version == "" {
		// Detection failed at connect — surface that rather than guessing.
		if c.versionErr != nil {
			return false, "", fmt.Errorf("server version unavailable: %w", c.versionErr)
		}
		return false, "", fmt.Errorf("server version unavailable")
	}
	if compareVersions(c.version, minExplainAnalyzeVersion) >= 0 {
		return true, "", nil
	}
	return false, fmt.Sprintf("EXPLAIN ANALYZE requires ClickHouse %s or later; this server is %s", minExplainAnalyzeVersion, c.version), nil
}

// compareVersions compares two dot-separated ClickHouse version strings
// (e.g. "26.5.1.882" vs "26.7"). Numeric components are compared in order; a
// shorter version is treated as 0 for missing components, so "26.7" >= "26.7".
// Non-numeric components (e.g. a "-stable" suffix) are ignored on the tail.
// Returns -1, 0, or +1 like bytes.Compare.
func compareVersions(a, b string) int {
	ax := splitVersion(a)
	bx := splitVersion(b)
	n := len(ax)
	if len(bx) > n {
		n = len(bx)
	}
	for i := 0; i < n; i++ {
		ai, bi := component(ax, i), component(bx, i)
		switch {
		case ai < bi:
			return -1
		case ai > bi:
			return 1
		}
	}
	return 0
}

// splitVersion returns the leading numeric components of a version string,
// stopping at the first non-numeric/separator-run (e.g. the "-stable" tail).
func splitVersion(v string) []int {
	parts := strings.Split(v, ".")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		// Trim any non-numeric suffix within a component (e.g. "882-stable").
		numStr := p
		for i, r := range p {
			if r < '0' || r > '9' {
				numStr = p[:i]
				break
			}
		}
		if numStr == "" {
			break
		}
		n, err := strconv.Atoi(numStr)
		if err != nil {
			break
		}
		out = append(out, n)
	}
	return out
}

func component(parts []int, i int) int {
	if i < len(parts) {
		return parts[i]
	}
	return 0
}

// analyzeTimeRe matches the ANALYZE "Time:" summary line, e.g.
//
//	"  Time:        10.72 ms (planning 6.45 ms · execution 4.26 ms)"
//
// The planning/execution split is optional — older builds may omit it.
var analyzeTimeRe = regexp.MustCompile(
	`Time:\s*([\d.]+)\s*(\w+)\s*(?:\(\s*planning\s*([\d.]+)\s*\w+\s*[·•]\s*execution\s*([\d.]+)\s*\w+\s*\))?`,
)

// analyzeReadRe matches the "Read:" line, e.g.
//
//	"  Read:        1.00 million rows, 8.00 MB (234.49 million rows/s., 1.88 GB/s.)"
//
// Units are converted to base rows/bytes and per-second rates.
var analyzeReadRe = regexp.MustCompile(
	`Read:\s*([\d.]+)\s*(\w+)\s*rows?,\s*([\d.]+)\s*(\w+)[Bb]?(?:\s*\(\s*([\d.]+)\s*(\w+)\s*rows?/s\.?,\s*([\d.]+)\s*(\w+)[Bb]?/s\.?\s*\))?`,
)

// analyzePeakMemRe matches the "Peak memory:" line, e.g.
//
//	"  Peak memory: 28.98 KiB"
var analyzePeakMemRe = regexp.MustCompile(`Peak memory:\s*([\d.]+)\s*(\w+)`)

// parseAnalyzeSummary extracts the high-level metrics from the "Query
// summary" block. It is intentionally tolerant: missing or differently
// formatted lines leave their fields zero-valued rather than failing.
func parseAnalyzeSummary(raw string) ExplainAnalyzeSummary {
	var s ExplainAnalyzeSummary
	for _, line := range strings.Split(raw, "\n") {
		trim := strings.TrimSpace(line)
		if m := analyzeTimeRe.FindStringSubmatch(trim); m != nil {
			s.TotalMs = toMillis(m[1], m[2])
			s.PlanningMs = toMillis(m[3], "")
			s.ExecutionMs = toMillis(m[4], "")
			continue
		}
		if m := analyzeReadRe.FindStringSubmatch(trim); m != nil {
			s.ReadRows = scaleCount(m[1], m[2])
			s.ReadBytes = scaleBytes(m[3], m[4])
			if m[5] != "" {
				s.RowsPerSec = scaleCountFloat(m[5], m[6])
			}
			if m[7] != "" {
				s.BytesPerSec = scaleBytesFloat(m[7], m[8])
			}
			continue
		}
		if m := analyzePeakMemRe.FindStringSubmatch(trim); m != nil {
			s.PeakMemory = scaleBytes(m[1], m[2])
		}
	}
	return s
}

// toMillis converts a numeric value + unit (ms/us/s/ns) to milliseconds.
// An empty value/unit yields 0.
func toMillis(val, unit string) float64 {
	if val == "" {
		return 0
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return 0
	}
	// Infer the unit from the summary line when the per-field unit is empty
	// (the planning/execution sub-fields inherit the line's unit).
	u := unit
	if u == "" {
		u = "ms"
	}
	switch strings.ToLower(u) {
	case "ns":
		return f / 1e6
	case "us", "µs":
		return f / 1e3
	case "s":
		return f * 1e3
	default: // ms
		return f
	}
}

// scaleCount converts a numeric value with a magnitude suffix
// (million/billion/thousand) into a raw count.
func scaleCount(val, unit string) uint64 {
	return uint64(scaleCountFloat(val, unit) + 0.5)
}

// scaleCountFloat is the float64 variant, used for per-second rates.
func scaleCountFloat(val, unit string) float64 {
	f, ok := parseFloat(val)
	if !ok {
		return 0
	}
	switch strings.ToLower(unit) {
	case "thousand":
		f *= 1e3
	case "million":
		f *= 1e6
	case "billion":
		f *= 1e9
	}
	return f
}

// scaleBytes converts a numeric value with a binary unit (B/KiB/MiB/...)
// into raw bytes.
func scaleBytes(val, unit string) uint64 {
	return uint64(scaleBytesFloat(val, unit) + 0.5)
}

// scaleBytesFloat is the float64 variant, used for per-second rates.
func scaleBytesFloat(val, unit string) float64 {
	f, ok := parseFloat(val)
	if !ok {
		return 0
	}
	switch strings.ToLower(unit) {
	case "b":
		return f
	case "kib", "kb":
		return f * 1024
	case "mib", "mb":
		return f * 1024 * 1024
	case "gib", "gb":
		return f * 1024 * 1024 * 1024
	case "tib", "tb":
		return f * 1024 * 1024 * 1024 * 1024
	}
	return f
}

func parseFloat(val string) (float64, bool) {
	if val == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}
