package clickhouse

import (
	"strings"
	"testing"
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

	for _, want := range []string{
		"NOT has(databases, 'system')",
		"lower(query_kind) NOT IN",
		"log_comment != 'clicklens'",
	} {
		if !strings.Contains(clause, want) {
			t.Errorf("hideSystemQueriesClause() = %q, expected to contain %q", clause, want)
		}
	}
}
