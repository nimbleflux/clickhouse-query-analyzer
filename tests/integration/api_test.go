//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/api"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func setupIntegrationAPI(t *testing.T) (*api.API, http.Handler) {
	t.Helper()
	pool := clickhouse.NewPool()
	t.Cleanup(pool.CloseAll)

	cfg := &config.Config{Version: "test"}
	a := api.New(pool, cfg)
	return a, api.Router(cfg, a, nil)
}

func chHeaders() map[string]string {
	return map[string]string{
		"X-CH-URL":  clickhouseURL(),
		"X-CH-User": "default",
	}
}

func makeReq(t *testing.T, router http.Handler, method, path string, headers map[string]string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestIntegration_Connect(t *testing.T) {
	_, router := setupIntegrationAPI(t)
	w := makeReq(t, router, "POST", "/api/connect", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestIntegration_GetSchema(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	w := makeReq(t, router, "GET", "/api/schema", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	json.NewDecoder(w.Body).Decode(&result)
	dbs, ok := result["databases"].([]interface{})
	if !ok {
		t.Fatal("expected databases array")
	}
	if len(dbs) == 0 {
		t.Error("expected at least one database")
	}
}

func TestIntegration_ListQueries(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	w := makeReq(t, router, "GET", "/api/queries", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	json.NewDecoder(w.Body).Decode(&result)
	if _, ok := result["queries"]; !ok {
		t.Error("expected queries field in response")
	}
}

func TestIntegration_ExecuteQuery(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	body := `{"query": "SELECT 1 AS value", "max_rows": 10}`
	w := makeReq(t, router, "POST", "/api/execute", chHeaders(), body)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]interface{}
	json.NewDecoder(w.Body).Decode(&result)
	if result["row_count"].(float64) != 1 {
		t.Errorf("expected 1 row, got %v", result["row_count"])
	}
}

func TestIntegration_GetTables(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	w := makeReq(t, router, "GET", "/api/schema/system/tables", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestIntegration_Optimizer(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool := clickhouse.NewPool()
	defer pool.CloseAll()

	c, err := pool.Get(ctx, clickhouse.ConnParams{
		URL:      clickhouseURL(),
		User:     "default",
		Database: "system",
	})
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}

	analysis, err := c.AnalyzeTable(ctx, "analytics", "events")
	if err != nil {
		t.Fatalf("AnalyzeTable failed: %v", err)
	}

	if analysis.Table != "events" {
		t.Errorf("expected table 'events', got %s", analysis.Table)
	}
	if analysis.Database != "analytics" {
		t.Errorf("expected database 'analytics', got %s", analysis.Database)
	}
	if analysis.Engine == "" {
		t.Error("expected non-empty engine")
	}
	if len(analysis.Columns) == 0 {
		t.Error("expected columns to be analyzed")
	}
}

func TestIntegration_VersionAndHealth(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	w := makeReq(t, router, "GET", "/health", nil, "")
	if w.Code != http.StatusOK {
		t.Errorf("health: expected 200, got %d", w.Code)
	}

	w = makeReq(t, router, "GET", "/api/version", nil, "")
	if w.Code != http.StatusOK {
		t.Errorf("version: expected 200, got %d", w.Code)
	}
}
