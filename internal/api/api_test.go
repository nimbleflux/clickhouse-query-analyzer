package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func TestVersionEndpoint(t *testing.T) {
	cfg := &config.Config{Version: "1.2.3"}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/api/version", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result map[string]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if result["version"] != "1.2.3" {
		t.Errorf("expected version '1.2.3', got %v", result["version"])
	}
}

func TestHealthEndpoint(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if w.Body.String() != "ok" {
		t.Errorf("expected 'ok', got %q", w.Body.String())
	}
}

func TestConnect_MissingURL(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("POST", "/api/connect", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing URL, got %d", w.Code)
	}
}

func TestCORS_Headers(t *testing.T) {
	cfg := &config.Config{CORSOrigin: "*"}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("OPTIONS", "/api/connect", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for OPTIONS, got %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected CORS origin header '*', got %q", w.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORS_CustomOrigin(t *testing.T) {
	cfg := &config.Config{CORSOrigin: "https://example.com"}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("OPTIONS", "/api/connect", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Header().Get("Access-Control-Allow-Origin") != "https://example.com" {
		t.Errorf("expected CORS origin 'https://example.com', got %q", w.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestReadonly_RejectsWrite(t *testing.T) {
	tests := []struct {
		query  string
		reject bool
	}{
		{"INSERT INTO t VALUES (1)", true},
		{"DROP TABLE t", true},
		{"ALTER TABLE t ADD COLUMN x Int32", true},
		{"CREATE TABLE t (x Int32)", true},
		{"TRUNCATE TABLE t", true},
		{"SELECT 1", false},
		{"EXPLAIN SELECT 1", false},
		{"select * from t", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			w := httptest.NewRecorder()
			rejected := rejectWriteQuery(w, tt.query)
			if rejected != tt.reject {
				t.Errorf("rejectWriteQuery(%q) = %v, want %v", tt.query, rejected, tt.reject)
			}
		})
	}
}

func TestAPIRoutes_Exist(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	routes := []struct {
		method string
		path   string
	}{
		{"POST", "/api/connect"},
		{"POST", "/api/execute"},
		{"GET", "/api/schema"},
		{"GET", "/api/queries"},
		{"GET", "/api/queries/test-id"},
		{"GET", "/api/queries/test-id/metrics"},
		{"GET", "/api/queries/test-id/threads"},
		{"GET", "/api/queries/test-id/threads/summaries"},
		{"GET", "/api/queries/test-id/trace"},
		{"GET", "/api/queries/test-id/flamegraph"},
		{"GET", "/api/queries/test-id/views"},
		{"POST", "/api/queries/test-id/explain"},
		{"GET", "/api/optimizer"},
		{"GET", "/api/optimizer/mydb"},
		{"GET", "/api/optimizer/mydb/mytable"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			req.Header.Set("X-CH-URL", "clickhouse://localhost:9000")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code == http.StatusNotFound {
				t.Errorf("route %s %s returned 404", route.method, route.path)
			}
		})
	}
}
