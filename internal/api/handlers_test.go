package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func TestExecuteQuery_NoServer(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("POST", "/api/execute", nil)
	req.Header.Set("X-CH-URL", "clickhouse://localhost:9000")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("expected 502 without server, got %d", w.Code)
	}
}

func TestConnectEndpoint_NoServer(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("POST", "/api/connect", nil)
	req.Header.Set("X-CH-URL", "clickhouse://localhost:9000")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for connect without server, got %d", w.Code)
	}
}

func TestWriteJSON_NilValue(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, nil)
	if w.Body.String() != "null" {
		t.Errorf("expected 'null', got %q", w.Body.String())
	}
}

func TestWriteJSON_NilSlice(t *testing.T) {
	w := httptest.NewRecorder()
	var s []string
	writeJSON(w, http.StatusOK, s)
	if w.Body.String() != "[]" {
		t.Errorf("expected '[]', got %q", w.Body.String())
	}
}

func TestWriteJSON_ValidValue(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	var result map[string]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if result["status"] != "ok" {
		t.Errorf("expected status 'ok', got %q", result["status"])
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusInternalServerError, "something broke")
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
	var result map[string]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if result["error"] != "something broke" {
		t.Errorf("expected error message, got %q", result["error"])
	}
}

func TestRejectWriteQuery_Extended(t *testing.T) {
	tests := []struct {
		query  string
		reject bool
	}{
		{"KILL QUERY WHERE query_id='x'", true},
		{"SYSTEM FLUSH LOGS", true},
		{"OPTIMIZE TABLE t FINAL", true},
		{"DETACH TABLE t", true},
		{"ATTACH TABLE t", true},
		{"RENAME TABLE t TO t2", true},
		{"GRANT SELECT ON t TO user", true},
		{"REVOKE SELECT ON t FROM user", true},
		{"DELETE FROM t WHERE id = 1", true},
		{"UPDATE t SET x = 1", true},
		{"WITH cte AS (SELECT 1) SELECT * FROM cte", false},
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

func TestIsReadonly(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	if isReadonly(req) {
		t.Error("expected readonly to be false without header")
	}
	req.Header.Set("X-CH-Readonly", "1")
	if !isReadonly(req) {
		t.Error("expected readonly to be true with header '1'")
	}
}

func TestClientFromRequest_MissingURL(t *testing.T) {
	api := New(clickhouse.NewPool())
	req := httptest.NewRequest("GET", "/", nil)
	_, err := api.clientFromRequest(req)
	if err == nil {
		t.Error("expected error when URL is missing")
	}
}

func TestMetricsEndpoint(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for /metrics, got %d", w.Code)
	}
}

func TestQueryRoutes_ReturnNon404(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool())
	router := Router(cfg, api, nil)

	routes := []struct {
		method string
		path   string
	}{
		{"GET", "/api/queries"},
		{"GET", "/api/queries/test-id/metrics"},
		{"GET", "/api/queries/test-id/threads"},
		{"GET", "/api/queries/test-id/trace"},
		{"GET", "/api/queries/test-id/flamegraph"},
		{"GET", "/api/queries/test-id/views"},
		{"POST", "/api/queries/test-id/explain"},
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
