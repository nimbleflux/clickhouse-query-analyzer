package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func TestVersionEndpoint(t *testing.T) {
	cfg := &config.Config{Version: "1.2.3"}
	api := New(clickhouse.NewPool(), nil)
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
	api := New(clickhouse.NewPool(), nil)
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
	api := New(clickhouse.NewPool(), nil)
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
	api := New(clickhouse.NewPool(), nil)
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
	api := New(clickhouse.NewPool(), nil)
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
	api := New(clickhouse.NewPool(), nil)
	router := Router(cfg, api, nil)

	routes := []struct {
		method string
		path   string
	}{
		{"POST", "/api/connect"},
		{"GET", "/api/config"},
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

func TestGetConfig_NoDefaults(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool(), cfg)
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if _, exists := result["default_connection"]; exists {
		t.Errorf("expected no default_connection when no env vars set, got %v", result["default_connection"])
	}
}

func TestGetConfig_WithDefaults(t *testing.T) {
	cfg := &config.Config{
		ClickHouseURL:  "clickhouse://ch-server:9000",
		ClickHouseUser: "analyst",
		ClickHouseDB:   "analytics",
	}
	api := New(clickhouse.NewPool(), cfg)
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var result map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	dc, ok := result["default_connection"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected default_connection in response, got %v", result)
	}
	if dc["url"] != "clickhouse://ch-server:9000" {
		t.Errorf("expected url 'clickhouse://ch-server:9000', got %v", dc["url"])
	}
	if dc["user"] != "analyst" {
		t.Errorf("expected user 'analyst', got %v", dc["user"])
	}
	if dc["database"] != "analytics" {
		t.Errorf("expected database 'analytics', got %v", dc["database"])
	}
	if dc["has_password"] != false {
		t.Errorf("expected has_password false, got %v", dc["has_password"])
	}
	// Password must never be exposed
	if _, exists := dc["password"]; exists {
		t.Errorf("password must not be in response, got %v", dc["password"])
	}
}

func TestGetConfig_WithPassword(t *testing.T) {
	cfg := &config.Config{
		ClickHouseURL:  "clickhouse://ch:9000",
		ClickHousePass: "secret",
	}
	api := New(clickhouse.NewPool(), cfg)
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	var result map[string]interface{}
	json.NewDecoder(w.Body).Decode(&result)
	dc := result["default_connection"].(map[string]interface{})
	if dc["has_password"] != true {
		t.Errorf("expected has_password true, got %v", dc["has_password"])
	}
	if _, exists := dc["password"]; exists {
		t.Errorf("password value must not be exposed, got %v", dc["password"])
	}
}

func TestClientFromRequest_FallsBackToServerDefault(t *testing.T) {
	cfg := &config.Config{
		ClickHouseURL:  "clickhouse://fallback-host:9000",
		ClickHouseUser: "fallback-user",
	}
	api := New(clickhouse.NewPool(), cfg)

	// Request without any X-CH-* headers — should fall back to server defaults
	// rather than returning the "URL not configured" error.
	req := httptest.NewRequest("GET", "/api/dashboard", nil)
	_, err := api.clientFromRequest(req)

	// We expect either a connection error (no real CH server) or success — but
	// NOT the "URL not configured" error, since the fallback should kick in.
	if err != nil && strings.Contains(err.Error(), "not configured") {
		t.Errorf("expected fallback to server default URL, got 'not configured' error: %v", err)
	}
}
