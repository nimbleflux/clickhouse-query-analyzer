package api

import (
	"net/http/httptest"
	"testing"
)

func TestIsSystemDatabase(t *testing.T) {
	tests := []struct {
		db       string
		expected bool
	}{
		{"system", true},
		{"INFORMATION_SCHEMA", true},
		{"information_schema", true},
		{"_system", true},
		{"default", false},
		{"Default", false},
		{"tmp", true},
		{"temp", true},
		{"mydb", false},
		{"production", false},
		{"analytics", false},
	}

	for _, tt := range tests {
		t.Run(tt.db, func(t *testing.T) {
			if got := isSystemDatabase(tt.db); got != tt.expected {
				t.Errorf("isSystemDatabase(%q) = %v, want %v", tt.db, got, tt.expected)
			}
		})
	}
}

func TestParseBulkFilters_Defaults(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/optimizer/mydb", nil)
	filters := parseBulkFilters(req)

	if !filters.ExcludeSystem {
		t.Error("expected ExcludeSystem to be true by default")
	}
	if filters.Engine != "" {
		t.Errorf("expected empty engine, got %s", filters.Engine)
	}
	if filters.MinRows != 0 {
		t.Errorf("expected 0 min rows, got %d", filters.MinRows)
	}
	if filters.MinBytes != 0 {
		t.Errorf("expected 0 min bytes, got %d", filters.MinBytes)
	}
}

func TestParseBulkFilters_Custom(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/optimizer/mydb?engine=MergeTree&min_rows=1000&min_bytes=5000&exclude_system=false", nil)
	filters := parseBulkFilters(req)

	if filters.Engine != "MergeTree" {
		t.Errorf("expected MergeTree engine, got %s", filters.Engine)
	}
	if filters.MinRows != 1000 {
		t.Errorf("expected 1000 min rows, got %d", filters.MinRows)
	}
	if filters.MinBytes != 5000 {
		t.Errorf("expected 5000 min bytes, got %d", filters.MinBytes)
	}
	if filters.ExcludeSystem {
		t.Error("expected ExcludeSystem to be false")
	}
}

func TestParseBulkFilters_ExcludeSystemTrue(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/optimizer/mydb?exclude_system=true", nil)
	filters := parseBulkFilters(req)

	if !filters.ExcludeSystem {
		t.Error("expected ExcludeSystem to remain true when set to 'true'")
	}
}
