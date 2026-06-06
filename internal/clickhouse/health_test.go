package clickhouse

import (
	"strings"
	"testing"
)

func TestParseEstimateLine(t *testing.T) {
	t.Run("valid line", func(t *testing.T) {
		e := parseEstimateLine("1000\t50\t4096\t3\t12\tTableScan")
		if e == nil {
			t.Fatal("expected non-nil result")
		}
		if e.Rows != 1000 || e.Blocks != 50 || e.Bytes != 4096 || e.Parts != 3 || e.Marks != 12 {
			t.Errorf("got %+v", e)
		}
	})

	t.Run("line with spaces", func(t *testing.T) {
		e := parseEstimateLine("5000 100 8192 5 20")
		if e == nil {
			t.Fatal("expected non-nil result")
		}
		if e.Rows != 5000 || e.Marks != 20 {
			t.Errorf("got %+v", e)
		}
	})

	t.Run("insufficient fields", func(t *testing.T) {
		if parseEstimateLine("100 50") != nil {
			t.Error("expected nil for short line")
		}
	})

	t.Run("non-numeric", func(t *testing.T) {
		if parseEstimateLine("abc 50 4096 3 12") != nil {
			t.Error("expected nil for non-numeric")
		}
	})
}

func TestDeriveWarnings(t *testing.T) {
	c := &Client{}

	hasWarning := func(r *HealthReport, sub string) bool {
		for _, w := range r.Warnings {
			if strings.Contains(w, sub) {
				return true
			}
		}
		return false
	}

	t.Run("all good", func(t *testing.T) {
		r := &HealthReport{
			Settings: []SettingValue{
				{Name: "log_queries", Value: "1"},
				{Name: "log_query_threads", Value: "1"},
				{Name: "allow_introspection_functions", Value: "1"},
			},
			LogTables: []LogTableSize{
				{Table: "query_log", Exists: true, Rows: 100},
				{Table: "trace_log", Exists: true, Rows: 50},
			},
		}
		c.deriveWarnings(r)
		if len(r.Warnings) != 0 {
			t.Errorf("expected no warnings, got %d: %v", len(r.Warnings), r.Warnings)
		}
	})

	t.Run("log_queries disabled", func(t *testing.T) {
		r := &HealthReport{
			Settings: []SettingValue{
				{Name: "log_queries", Value: "0"},
			},
		}
		c.deriveWarnings(r)
		if !hasWarning(r, "log_queries is disabled") {
			t.Error("expected log_queries warning")
		}
	})

	t.Run("allow_introspection disabled", func(t *testing.T) {
		r := &HealthReport{
			Settings: []SettingValue{
				{Name: "allow_introspection_functions", Value: "0"},
			},
		}
		c.deriveWarnings(r)
		if !hasWarning(r, "allow_introspection_functions") {
			t.Error("expected allow_introspection_functions warning")
		}
	})

	t.Run("empty trace_log", func(t *testing.T) {
		r := &HealthReport{
			LogTables: []LogTableSize{
				{Table: "trace_log", Exists: true, Rows: 0},
			},
		}
		c.deriveWarnings(r)
		if !hasWarning(r, "trace_log is empty") {
			t.Error("expected trace_log warning")
		}
	})

	t.Run("empty query_log", func(t *testing.T) {
		r := &HealthReport{
			LogTables: []LogTableSize{
				{Table: "query_log", Exists: true, Rows: 0},
			},
		}
		c.deriveWarnings(r)
		if !hasWarning(r, "query_log is empty") {
			t.Error("expected query_log warning")
		}
	})
}
