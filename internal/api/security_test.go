package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func TestReadonly_RejectsCommentPrefixedWrites(t *testing.T) {
	// The old prefix check matched the raw trimmed query, so a leading
	// comment hid the write from it.
	tests := []struct {
		query  string
		reject bool
	}{
		{"/* x */ DROP TABLE t", true},
		{"-- stealth\nINSERT INTO t VALUES (1)", true},
		{"/* a */ -- b\nTRUNCATE t", true},
		{"SELECT 1 /* trailing comment stays fine */", false},
		{"/* only a comment */", true}, // nothing sensible to run: fail closed
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			w := httptest.NewRecorder()
			if rejected := rejectWriteQuery(w, tt.query); rejected != tt.reject {
				t.Errorf("rejectWriteQuery(%q) = %v, want %v", tt.query, rejected, tt.reject)
			}
		})
	}
}

func TestRequireJSONContentType(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool(), cfg)
	router := Router(cfg, api, nil)

	// text/plain POST (a CORS "simple request") must be refused with 415.
	req := httptest.NewRequest("POST", "/api/mutations/kill", nil)
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("X-CH-URL", "clickhouse://localhost:9000")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain POST: got %d, want 415", w.Code)
	}

	// application/json passes the gate and proceeds to the handler.
	req = httptest.NewRequest("POST", "/api/mutations/kill", nil)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CH-URL", "clickhouse://localhost:9000")
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code == http.StatusUnsupportedMediaType {
		t.Fatalf("application/json POST must not be refused with 415, got %d", w.Code)
	}

	// Bodyless /connect stays exempt (no side effects).
	req = httptest.NewRequest("POST", "/api/connect", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code == http.StatusUnsupportedMediaType {
		t.Fatalf("/connect without content type must be exempt, got 415")
	}
}

func TestManageEndpoints_HonorReadonly(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool(), cfg)
	router := Router(cfg, api, nil)

	routes := []struct {
		method string
		path   string
	}{
		{"POST", "/api/processes/some-id/kill"},
		{"POST", "/api/mutations/kill"},
		{"POST", "/api/access/users/bob/drop"},
		{"POST", "/api/access/roles/r/drop"},
		{"POST", "/api/access/grants/revoke"},
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-CH-Readonly", "1")
			req.Header.Set("X-CH-URL", "clickhouse://localhost:9000")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusForbidden {
				t.Fatalf("readonly: got %d, want 403", w.Code)
			}
		})
	}
}

func TestGetConfig_HideDefaultConnection(t *testing.T) {
	cfg := &config.Config{
		ClickHouseURL:         "clickhouse://internal:9000",
		ClickHouseUser:        "svc",
		HideDefaultConnection: true,
	}
	api := New(clickhouse.NewPool(), cfg)
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, exists := result["default_connection"]; exists {
		t.Errorf("default_connection must be withheld when -hide-default-connection is set, got %v", result)
	}
}
