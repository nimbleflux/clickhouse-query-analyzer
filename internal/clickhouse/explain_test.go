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
