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

func chJSONHeaders() map[string]string {
	h := chHeaders()
	h["Content-Type"] = "application/json"
	return h
}

// executeAndParseStream runs /api/execute and returns the parsed NDJSON
// events (started, progress*, result|error).
func executeAndParseStream(t *testing.T, router http.Handler, body string) []map[string]interface{} {
	t.Helper()
	w := makeReq(t, router, "POST", "/api/execute", chJSONHeaders(), body)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var events []map[string]interface{}
	for _, line := range strings.Split(strings.TrimSpace(w.Body.String()), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var evt map[string]interface{}
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			t.Fatalf("bad NDJSON line %q: %v", line, err)
		}
		events = append(events, evt)
	}
	return events
}

func streamEventOfType(t *testing.T, events []map[string]interface{}, typ string) map[string]interface{} {
	t.Helper()
	for _, e := range events {
		if e["type"] == typ {
			return e
		}
	}
	t.Fatalf("no %q event in stream (%d events)", typ, len(events))
	return nil
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

	events := executeAndParseStream(t, router, `{"query": "SELECT 1 AS value", "max_rows": 10}`)

	started := streamEventOfType(t, events, "started")
	if started["query_id"] == "" {
		t.Error("started event must carry a query_id (targets progress polling and KILL)")
	}
	result := streamEventOfType(t, events, "result")["result"].(map[string]interface{})
	if result["row_count"].(float64) != 1 {
		t.Errorf("expected 1 row, got %v", result["row_count"])
	}
	// The hidden count() query is gone: totals are unknown until the user
	// explicitly asks for a count.
	if result["total_rows"].(float64) != -1 {
		t.Errorf("expected total_rows -1 (no implicit count), got %v", result["total_rows"])
	}
}

func TestIntegration_ExecuteCount(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	body := `{"query": "SELECT number FROM system.numbers LIMIT 50"}`
	w := makeReq(t, router, "POST", "/api/execute/count", chJSONHeaders(), body)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var result map[string]interface{}
	json.NewDecoder(w.Body).Decode(&result)
	if result["count"].(float64) != 50 {
		t.Errorf("expected count 50, got %v", result["count"])
	}
}

func TestIntegration_ExecuteCancel(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	// Cancel for a query_id that never existed: KILL QUERY is a no-op that
	// must still answer 200.
	w := makeReq(t, router, "POST", "/api/execute/cancel", chJSONHeaders(), `{"query_id": "does-not-exist"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for no-op cancel, got %d: %s", w.Code, w.Body.String())
	}
}

func TestIntegration_DetachedJob(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	body := `{"query": "SELECT number, number % 7 AS m FROM system.numbers LIMIT 100", "detached": true, "max_rows": 10}`
	w := makeReq(t, router, "POST", "/api/execute", chJSONHeaders(), body)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var started map[string]interface{}
	json.NewDecoder(w.Body).Decode(&started)
	jobID, _ := started["job_id"].(string)
	if jobID == "" {
		t.Fatalf("expected job_id, got %v", started)
	}

	// Poll until done (fast query — should be immediate).
	var job map[string]interface{}
	for i := 0; i < 20; i++ {
		w = makeReq(t, router, "GET", "/api/jobs/"+jobID, chHeaders(), "")
		if w.Code != http.StatusOK {
			t.Fatalf("job poll: expected 200, got %d", w.Code)
		}
		job = map[string]interface{}{}
		json.NewDecoder(w.Body).Decode(&job)
		if job["status"] == "done" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if job["status"] != "done" {
		t.Fatalf("expected job done, got %v", job["status"])
	}
	result := job["result"].(map[string]interface{})
	if result["row_count"].(float64) != 10 {
		t.Errorf("expected 10 buffered rows (page size), got %v", result["row_count"])
	}

	// Cancel after completion is a benign no-op.
	w = makeReq(t, router, "POST", "/api/jobs/"+jobID+"/cancel", chJSONHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("cancel after finish: expected 200, got %d", w.Code)
	}
}

func TestIntegration_Advisor(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	// The advisor is best-effort: the assertion is that a query touching a
	// remote-engine table (the dev stack seeds one on MinIO) succeeds and the
	// stream carries a result. When the seeded table exists, the result
	// carries advisor warnings.
	w := makeReq(t, router, "GET", "/api/advisor/remote-tables", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("remote-tables: expected 200, got %d", w.Code)
	}

	events := executeAndParseStream(t, router, `{"query": "SELECT 1", "max_rows": 1}`)
	streamEventOfType(t, events, "result")
}

func TestIntegration_ParamBinding(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	body := `{"query": "SELECT {{n}} AS v", "params": {"n": "42"}, "max_rows": 5}`
	events := executeAndParseStream(t, router, body)
	result := streamEventOfType(t, events, "result")["result"].(map[string]interface{})
	rows := result["rows"].([]interface{})
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	first := rows[0].(map[string]interface{})
	if v, ok := first["v"].(float64); !ok || v != 42 {
		t.Errorf("param should bind as Int64 42, got %v (%T)", first["v"], first["v"])
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

func TestIntegration_SchemaGraph(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	// Idempotent demo chain: source → MV → target, plus a plain view.
	ddl := []string{
		`CREATE DATABASE IF NOT EXISTS graph_demo`,
		`CREATE TABLE IF NOT EXISTS graph_demo.source_events (id UInt64, day Date) ENGINE = MergeTree ORDER BY id`,
		`CREATE TABLE IF NOT EXISTS graph_demo.source_events_target (day Date, n UInt64) ENGINE = SummingMergeTree ORDER BY day`,
		`CREATE MATERIALIZED VIEW IF NOT EXISTS graph_demo.source_events_mv TO graph_demo.source_events_target AS SELECT day, count() AS n FROM graph_demo.source_events GROUP BY day`,
		`DROP VIEW IF EXISTS graph_demo.source_events_view`,
		`CREATE VIEW IF NOT EXISTS graph_demo.source_events_view AS SELECT * FROM graph_demo.source_events`,
	}
	for _, stmt := range ddl {
		w := makeReq(t, router, "POST", "/api/execute", chJSONHeaders(), `{"query": `+quoteJSON(stmt)+`, "max_rows": 1}`)
		if w.Code != http.StatusOK {
			t.Fatalf("setup stmt failed: %s -> %d %s", stmt, w.Code, w.Body.String())
		}
	}

	// all=1: the full unfiltered graph (capped).
	w := makeReq(t, router, "GET", "/api/schema/graph?all=1", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var graph struct {
		Nodes []struct {
			Database string `json:"database"`
			Name     string `json:"name"`
			Kind     string `json:"kind"`
		} `json:"nodes"`
		Edges []struct {
			From string `json:"from"`
			To   string `json:"to"`
			Kind string `json:"kind"`
		} `json:"edges"`
		Truncated bool `json:"truncated"`
	}
	if err := json.NewDecoder(w.Body).Decode(&graph); err != nil {
		t.Fatalf("decode: %v", err)
	}

	kinds := map[string]string{}
	for _, n := range graph.Nodes {
		if n.Database == "graph_demo" {
			kinds[n.Name] = n.Kind
		}
	}
	for name, wantKind := range map[string]string{
		"source_events":        "mergetree",
		"source_events_target": "mergetree",
		"source_events_mv":     "mv",
		"source_events_view":   "view",
	} {
		if kinds[name] != wantKind {
			t.Errorf("graph_demo.%s kind = %q, want %q", name, kinds[name], wantKind)
		}
	}

	edgeSet := map[string]bool{}
	for _, e := range graph.Edges {
		edgeSet[e.From+"->"+e.To+"("+e.Kind+")"] = true
	}
	for _, want := range []string{
		"graph_demo.source_events->graph_demo.source_events_mv(mv)",
		"graph_demo.source_events_mv->graph_demo.source_events_target(mv)",
		"graph_demo.source_events->graph_demo.source_events_view(view)",
	} {
		if !edgeSet[want] {
			t.Errorf("missing edge %s; got %v", want, edgeSet)
		}
	}
}

func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// The UI defaults to a single database (unfiltered graphs don't scale); the
// filter must apply server-side while the databases summary stays complete.
func TestIntegration_SchemaGraphDbFilter(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	w := makeReq(t, router, "GET", "/api/schema/graph?database=graph_demo", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var graph struct {
		Nodes []struct {
			Database string `json:"database"`
			Name     string `json:"name"`
		} `json:"nodes"`
		Databases []struct {
			Database string `json:"database"`
			Tables   int    `json:"tables"`
		} `json:"databases"`
	}
	if err := json.NewDecoder(w.Body).Decode(&graph); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(graph.Nodes) == 0 {
		t.Fatal("expected filtered nodes")
	}
	for _, n := range graph.Nodes {
		if n.Database != "graph_demo" {
			t.Errorf("filter leaked: got table in %s", n.Database)
		}
	}
	// The picker summary must still cover the whole instance.
	dbs := map[string]int{}
	for _, d := range graph.Databases {
		dbs[d.Database] = d.Tables
	}
	if _, ok := dbs["graph_demo"]; !ok {
		t.Errorf("databases summary missing graph_demo: %v", dbs)
	}
	if _, ok := dbs["analytics"]; !ok {
		t.Errorf("databases summary must be unfiltered; missing analytics: %v", dbs)
	}
}

// Auto mode: no database param and no all=1 → the server picks the first
// database and scopes the whole graph to it in a single response, so the UI
// never loads every database at once.
func TestIntegration_SchemaGraphAutoSelectsFirstDb(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	w := makeReq(t, router, "GET", "/api/schema/graph", chHeaders(), "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var graph struct {
		Database string `json:"database"`
		Nodes    []struct {
			Database string `json:"database"`
		} `json:"nodes"`
		Databases []struct {
			Database string `json:"database"`
			Tables   int    `json:"tables"`
		} `json:"databases"`
	}
	if err := json.NewDecoder(w.Body).Decode(&graph); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if graph.Database == "" {
		t.Fatal("expected a resolved database in the response")
	}
	if len(graph.Nodes) == 0 {
		t.Fatal("expected nodes for the auto-selected database")
	}
	for _, n := range graph.Nodes {
		if n.Database != graph.Database {
			t.Errorf("auto-scoped graph leaked node from %q (selected %q)", n.Database, graph.Database)
		}
	}
	// The picker summary must still cover every database.
	if len(graph.Databases) < 2 {
		t.Errorf("databases summary should list all databases, got %v", graph.Databases)
	}
}
