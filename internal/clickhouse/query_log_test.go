package clickhouse

import (
	"strings"
	"testing"
	"time"
)

func TestDefaultListParams(t *testing.T) {
	if defaultListParams.Limit != 50 {
		t.Errorf("expected default limit 50, got %d", defaultListParams.Limit)
	}
	if defaultListParams.Offset != 0 {
		t.Errorf("expected default offset 0, got %d", defaultListParams.Offset)
	}
	if defaultListParams.SortBy != "query_start_time" {
		t.Errorf("expected default sort by query_start_time, got %s", defaultListParams.SortBy)
	}
	if defaultListParams.SortDir != "DESC" {
		t.Errorf("expected default sort dir DESC, got %s", defaultListParams.SortDir)
	}
}

func TestQueryListParams_Defaults(t *testing.T) {
	p := QueryListParams{}
	if p.Limit != 0 {
		t.Errorf("expected zero limit, got %d", p.Limit)
	}
	if p.SortBy != "" {
		t.Errorf("expected empty sort by, got %s", p.SortBy)
	}
}

func TestHideSystemQueriesClause(t *testing.T) {
	clause := hideSystemQueriesClause()

	if !strings.Contains(clause, "log_comment != 'clicklens'") {
		t.Errorf("hideSystemQueriesClause() = %q, expected to contain %q", clause, "log_comment != 'clicklens'")
	}

	// "Internal" means only ClickLens-issued queries (log_comment tag).
	// Earlier versions also excluded by query_kind (CREATE/DROP/ALTER/...),
	// which hid real user workload like dbt's DDL — that regression must
	// not come back.
	if strings.Contains(clause, "query_kind") {
		t.Errorf("hideSystemQueriesClause() = %q, should not filter by query_kind (hides user DDL like dbt)", clause)
	}

	// A user's own SELECT ... FROM system.* is real workload and must remain
	// visible, so the clause must not blanket-exclude the system database.
	if strings.Contains(clause, "has(databases, 'system')") {
		t.Errorf("hideSystemQueriesClause() = %q, should not exclude by databases='system'", clause)
	}
}

// TestProcessToEntry verifies the synthesis of a QueryLogEntry from a live
// system.processes row, the fallback path used when a query is still running
// and has no terminal query_log row yet.
func TestProcessToEntry(t *testing.T) {
	p := &ProcessEntry{
		QueryID:             "qid-123",
		Query:               "SELECT 1",
		User:                "alice",
		DurationMs:          1234.5,
		QueryStartTime:      time.Unix(1700000000, 0),
		PeakMemory:          5 * 1024 * 1024,
		ReadRows:            100,
		ReadBytes:           200,
		ThreadCount:         8,
		NormalizedQueryHash: "999",
		QueryKind:           "Select",
		IsInitialQuery:      1,
		InitialQueryID:      "qid-123",
	}
	e := processToEntry(p)

	if e.Type != "QueryStart" {
		t.Errorf("Type = %q, want QueryStart (so the UI shows Running)", e.Type)
	}
	if e.QueryID != p.QueryID {
		t.Errorf("QueryID = %q, want %q", e.QueryID, p.QueryID)
	}
	if e.QueryStartTime != p.QueryStartTime {
		t.Errorf("QueryStartTime not mapped from process")
	}
	if e.NormalizedQueryHash != "999" {
		t.Errorf("NormalizedQueryHash = %q, want %q", e.NormalizedQueryHash, p.NormalizedQueryHash)
	}
	if e.QueryKind != "Select" {
		t.Errorf("QueryKind = %q, want %q", e.QueryKind, p.QueryKind)
	}
	// UI labels this column "Peak Memory"; query_log.memory_usage is peak, so
	// the synthesis must map from the process peak, not current memory_usage.
	if e.MemoryUsage != uint64(p.PeakMemory) {
		t.Errorf("MemoryUsage = %d, want peak %d", e.MemoryUsage, p.PeakMemory)
	}
	// Empty slices/maps must be non-nil so JSON encodes [] / {} instead of null
	// (a finished row never serialises these as null).
	if e.Databases == nil || e.Tables == nil || e.Settings == nil || e.ProfileEvents == nil {
		t.Error("slice/map fields must be non-nil for running queries")
	}
}

func TestProcessToEntry_NegativePeakGuardsZero(t *testing.T) {
	// Peak memory should never be negative in practice, but a negative Int64
	// must not wrap to a huge uint64.
	e := processToEntry(&ProcessEntry{PeakMemory: -1})
	if e.MemoryUsage != 0 {
		t.Errorf("MemoryUsage = %d, want 0 for negative peak", e.MemoryUsage)
	}
}
