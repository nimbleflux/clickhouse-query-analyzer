package clickhouse

import (
	"context"
	"strings"
	"testing"
)

// TestGetExplain_SkipsNonSelect verifies that EXPLAIN is not even attempted
// for non-SELECT queries. Previously each view of a DDL/DML query in the UI
// fired five EXPLAIN variants at ClickHouse, every one failing with
// SYNTAX_ERROR and polluting the server's error log. The guard must
// short-circuit before any connection use.
func TestGetExplain_SkipsNonSelect(t *testing.T) {
	// Zero-value Client: conn is nil. If the guard fails and the function
	// tries to use it, the test crashes — which is the failure signal we want.
	c := &Client{}

	tests := []struct {
		name  string
		query string
	}{
		{"drop table", "DROP TABLE analytics.events"},
		{"ddl_entry commented drop", "/* ddl_entry=query-0000389051 */ DROP TABLE IF EXISTS analytics.events SYNC"},
		{"create", "CREATE TABLE t (x Int32)"},
		{"insert", "INSERT INTO t VALUES (1)"},
		{"alter", "ALTER TABLE t ADD COLUMN x Int32"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := c.GetExplain(context.Background(), tt.query)
			if err != nil {
				t.Fatalf("GetExplain returned err: %v", err)
			}
			if res == nil {
				t.Fatal("GetExplain returned nil result")
			}
			if res.Plan != "" || res.Pipeline != "" || res.PipelineGraph != "" || res.Syntax != "" || res.Estimate != nil {
				t.Errorf("expected empty result, got %+v", res)
			}
			msg := res.Errors["skipped"]
			if msg == "" {
				t.Fatalf("expected errors[skipped] to be set, got %v", res.Errors)
			}
			if !strings.Contains(msg, "SELECT") {
				t.Errorf("skipped message should mention SELECT, got %q", msg)
			}
		})
	}
}

// TestGetExplain_AttemptsSelect confirms the happy path actually reaches the
// connection (i.e. the guard doesn't over-eagerly skip SELECTs). A nil conn
// will panic if we get there — that's the success signal.
func TestGetExplain_AttemptsSelect(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected GetExplain to use the connection for a SELECT, but it returned without panicking (guard is too aggressive)")
		}
	}()
	c := &Client{}
	_, _ = c.GetExplain(context.Background(), "SELECT 1")
}

// TestGetExplainAnalyze_SkipsNonSelect mirrors the planner-only guard:
// EXPLAIN ANALYZE must short-circuit on DDL/DML since it re-executes the
// query, and that re-execution of an INSERT/CREATE would be destructive.
func TestGetExplainAnalyze_SkipsNonSelect(t *testing.T) {
	c := &Client{} // nil conn: short-circuit must avoid touching it.

	for _, query := range []string{
		"INSERT INTO t VALUES (1)",
		"CREATE TABLE t (x Int32)",
		"DROP TABLE t",
	} {
		res, err := c.GetExplainAnalyze(context.Background(), query, false)
		if err != nil {
			t.Fatalf("GetExplainAnalyze(%q) returned err: %v", query, err)
		}
		if res == nil || res.Raw != "" || res.Errors["skipped"] == "" {
			t.Fatalf("GetExplainAnalyze(%q) = %+v, want skipped", query, res)
		}
	}
}

// TestGetExplainAnalyze_AttemptsSelect confirms a SELECT reaches the
// connection (guard not over-eager). Nil conn panics on use — the success
// signal. Covers both processors=false and processors=true.
//
// The version field is set so the version gate passes and execution proceeds
// to the connection; otherwise the gate would short-circuit on a zero-value
// Client (empty version).
func TestGetExplainAnalyze_AttemptsSelect(t *testing.T) {
	for _, processors := range []bool{false, true} {
		func(processors bool) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("expected GetExplainAnalyze(processors=%v) to use the connection, but it returned without panicking", processors)
				}
			}()
			c := &Client{version: "26.7"}
			_, _ = c.GetExplainAnalyze(context.Background(), "SELECT 1", processors)
		}(processors)
	}
}

// TestGetExplainAnalyze_VersionGate verifies the cached version gate: on an
// unsupported server it short-circuits with errors.unsupported *without*
// touching the connection (a nil conn must not panic). This is the behaviour
// that replaced querying version() on every call.
func TestGetExplainAnalyze_VersionGate(t *testing.T) {
	t.Run("unsupported version short-circuits", func(t *testing.T) {
		c := &Client{version: "26.5.1.882"} // nil conn — must not be touched.
		res, err := c.GetExplainAnalyze(context.Background(), "SELECT 1", false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		msg := res.Errors["unsupported"]
		if msg == "" {
			t.Fatalf("expected errors[unsupported], got %+v", res.Errors)
		}
		if !strings.Contains(msg, "26.5.1.882") || !strings.Contains(msg, "26.7") {
			t.Errorf("unsupported message should name both versions, got %q", msg)
		}
	})

	t.Run("empty version surfaces an error", func(t *testing.T) {
		// Detection failed at connect — the gate should error rather than
		// guess. Nil conn must not be touched.
		c := &Client{}
		_, err := c.GetExplainAnalyze(context.Background(), "SELECT 1", false)
		if err == nil {
			t.Fatal("expected an error when version is unavailable, got nil")
		}
		if !strings.Contains(err.Error(), "version") {
			t.Errorf("error should mention version, got %q", err.Error())
		}
	})
}

// TestParseAnalyzeSummary_DocsExample parses the canonical example from the
// ClickHouse EXPLAIN ANALYZE documentation and asserts every summary field
// is captured with correct unit scaling.
func TestParseAnalyzeSummary_DocsExample(t *testing.T) {
	raw := `Query summary:
  Time:        10.72 ms (planning 6.45 ms · execution 4.26 ms)
  Read:        1.00 million rows, 8.00 MB (234.49 million rows/s., 1.88 GB/s.)
  Peak memory: 28.98 KiB

Expression ((Project names + Projection))
│  I/O: rows 10 → 10 · 90 B → 90 B
│    time 21.82 us (0.5%) · parallelism 0.98/1
`
	s := parseAnalyzeSummary(raw)
	if s.TotalMs != 10.72 {
		t.Errorf("TotalMs = %v, want 10.72", s.TotalMs)
	}
	if s.PlanningMs != 6.45 {
		t.Errorf("PlanningMs = %v, want 6.45", s.PlanningMs)
	}
	if s.ExecutionMs != 4.26 {
		t.Errorf("ExecutionMs = %v, want 4.26", s.ExecutionMs)
	}
	if s.ReadRows != 1_000_000 {
		t.Errorf("ReadRows = %v, want 1000000", s.ReadRows)
	}
	if s.ReadBytes != 8*1024*1024 {
		t.Errorf("ReadBytes = %v, want %v", s.ReadBytes, 8*1024*1024)
	}
	// "234.49 million rows/s." — rate rounds to 234490000.
	if s.RowsPerSec != 234490000 {
		t.Errorf("RowsPerSec = %v, want 234490000", s.RowsPerSec)
	}
	if s.BytesPerSec != 1.88*1024*1024*1024 {
		t.Errorf("BytesPerSec = %v, want %v", s.BytesPerSec, 1.88*1024*1024*1024)
	}
	if s.PeakMemory != 28*1024+roundFloat(0.98*1024) {
		t.Errorf("PeakMemory = %v, want %v", s.PeakMemory, 28*1024+roundFloat(0.98*1024))
	}
}

// TestParseAnalyzeSummary_PartialAndEmpty asserts the parser is tolerant:
// missing fields stay zero-valued rather than panicking.
func TestParseAnalyzeSummary_PartialAndEmpty(t *testing.T) {
	t.Run("no split", func(t *testing.T) {
		// Older builds may omit the planning/execution split.
		s := parseAnalyzeSummary("  Time:        5.00 ms\n")
		if s.TotalMs != 5.0 {
			t.Errorf("TotalMs = %v, want 5", s.TotalMs)
		}
		if s.PlanningMs != 0 || s.ExecutionMs != 0 {
			t.Errorf("split fields should be zero, got planning=%v execution=%v", s.PlanningMs, s.ExecutionMs)
		}
	})
	t.Run("empty", func(t *testing.T) {
		s := parseAnalyzeSummary("")
		if s != (ExplainAnalyzeSummary{}) {
			t.Errorf("empty input should yield zero summary, got %+v", s)
		}
	})
	t.Run("garbage", func(t *testing.T) {
		s := parseAnalyzeSummary("this is not a real explain analyze output\nat all")
		if s != (ExplainAnalyzeSummary{}) {
			t.Errorf("garbage input should yield zero summary, got %+v", s)
		}
	})
}

// TestParseUintOrZero covers the helper used for 26.7+ ESTIMATE columns
// (parseEstimateLine itself is covered in health_test.go).
func TestParseUintOrZero(t *testing.T) {
	tests := []struct {
		in   string
		want uint64
	}{
		{"428", 428},
		{"0", 0},
		{"", 0},
		{"abc", 0},
		{"-1", 0}, // ParseUint rejects negatives
	}
	for _, tt := range tests {
		if got := parseUintOrZero(tt.in); got != tt.want {
			t.Errorf("parseUintOrZero(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func roundFloat(f float64) uint64 { return uint64(f + 0.5) }

// TestCompareVersions covers the dot-separated ClickHouse version comparison
// used to gate EXPLAIN ANALYZE, including suffix tails and unequal lengths.
func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b string
		want int // -1, 0, +1
	}{
		// The motivating case: 26.5 is older than the 26.7 reintroduction.
		{"26.5.1.882", "26.7", -1},
		// 26.7.1.1052 is the merge build of the reintroduction — it is >= 26.7.
		{"26.7.1.1052", "26.7", 1},
		{"26.7", "26.7", 0},
		// Newer.
		{"26.8", "26.7", 1},
		{"27.0", "26.7", 1},
		// Suffix tail on a component is ignored.
		{"26.7.1.1052-stable", "26.7", 1},
		// Different lengths: shorter treated as 0 for missing components.
		{"26.7.1", "26.7.1.0", 0},
		{"26.7.1.1", "26.7.1", 1},
		// Old-style versioning (pre-ClickHouse unified scheme).
		{"24.3.5", "26.7", -1},
	}
	for _, tt := range tests {
		t.Run(tt.a+"_vs_"+tt.b, func(t *testing.T) {
			got := compareVersions(tt.a, tt.b)
			// Normalise to -1/0/1.
			if got < 0 {
				got = -1
			} else if got > 0 {
				got = 1
			}
			if got != tt.want {
				t.Errorf("compareVersions(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}
