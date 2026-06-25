package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func TestExecuteQuery_NoServer(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool(), nil)
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
	api := New(clickhouse.NewPool(), nil)
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
	Internal(w, fmt.Errorf("something broke"))
	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
	var result ApiError
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if result.Message != "something broke" {
		t.Errorf("expected error message, got %q", result.Message)
	}
	if result.Code != CodeInternal {
		t.Errorf("expected code %q, got %q", CodeInternal, result.Code)
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
	api := New(clickhouse.NewPool(), nil)
	req := httptest.NewRequest("GET", "/", nil)
	_, err := api.clientFromRequest(req)
	if err == nil {
		t.Error("expected error when URL is missing")
	}
}

func TestApiErrorShapes(t *testing.T) {
	t.Run("MissingParam", func(t *testing.T) {
		w := httptest.NewRecorder()
		MissingParam(w, "query_id")
		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", w.Code)
		}
		var e ApiError
		json.NewDecoder(w.Body).Decode(&e)
		if e.Code != CodeMissingParam {
			t.Errorf("expected CodeMissingParam, got %q", e.Code)
		}
		if e.Message != "query_id is required" {
			t.Errorf("unexpected message: %q", e.Message)
		}
		if e.Retry {
			t.Error("MissingParam should not be retryable")
		}
	})

	t.Run("NotFound", func(t *testing.T) {
		w := httptest.NewRecorder()
		NotFound(w, "query")
		if w.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d", w.Code)
		}
		var e ApiError
		json.NewDecoder(w.Body).Decode(&e)
		if e.Code != CodeNotFound {
			t.Errorf("expected CodeNotFound, got %q", e.Code)
		}
	})

	t.Run("CHUnreachableConnect", func(t *testing.T) {
		w := httptest.NewRecorder()
		CHUnreachable(w, true, fmt.Errorf("dial tcp: connection refused"))
		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for /connect, got %d", w.Code)
		}
		var e ApiError
		json.NewDecoder(w.Body).Decode(&e)
		if e.Code != CodeCHUnreachable {
			t.Errorf("expected CodeCHUnreachable, got %q", e.Code)
		}
		if !e.Retry {
			t.Error("CHUnreachable should be retryable")
		}
		if e.Hint == "" {
			t.Error("CHUnreachable should provide a hint")
		}
	})

	t.Run("CHUnreachableOther", func(t *testing.T) {
		w := httptest.NewRecorder()
		CHUnreachable(w, false, fmt.Errorf("auth failed"))
		if w.Code != http.StatusBadGateway {
			t.Errorf("expected 502 outside /connect, got %d", w.Code)
		}
	})

	t.Run("CHException", func(t *testing.T) {
		w := httptest.NewRecorder()
		CHException(w, fmt.Errorf("wrapped: %w", &clickhouse.CHError{
			Code:    clickhouse.CHSyntaxError,
			Message: "syntax error at position 5",
		}))
		if w.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for syntax error, got %d", w.Code)
		}
		var e ApiError
		json.NewDecoder(w.Body).Decode(&e)
		if e.Code != CodeCHException {
			t.Errorf("expected CodeCHException, got %q", e.Code)
		}
		if e.Retry {
			t.Error("Syntax errors should not be retryable")
		}
	})

	t.Run("CHExceptionRetryable", func(t *testing.T) {
		w := httptest.NewRecorder()
		CHException(w, fmt.Errorf("wrapped: %w", &clickhouse.CHError{
			Code:    clickhouse.CHMemoryLimit,
			Message: "memory limit exceeded",
		}))
		if w.Code != http.StatusBadGateway {
			t.Errorf("expected 502 for memory limit, got %d", w.Code)
		}
		var e ApiError
		json.NewDecoder(w.Body).Decode(&e)
		if !e.Retry {
			t.Error("Memory limit should be retryable")
		}
	})
}

func TestClassifyNotFoundSentinel(t *testing.T) {
	// Verify that ErrNotFound is classified correctly.
	chErr, isNotFound := clickhouse.Classify(clickhouse.NotFoundErrorf("thread 42"))
	if !isNotFound {
		t.Error("expected isNotFound=true for ErrNotFound sentinel")
	}
	if chErr == nil {
		t.Fatal("expected non-nil CHError")
	}
	if chErr.Code != clickhouse.CHNotFound {
		t.Errorf("expected code CHNotFound, got %d", chErr.Code)
	}
}

func TestClassifyHTTPError(t *testing.T) {
	// Simulate the error path produced by execute.go when CH HTTP body
	// starts with "Code: 60. DB::Exception: ..."
	err := fmt.Errorf("clickhouse error: Code: 60. DB::Exception: Unknown table")
	chErr, _ := clickhouse.Classify(err)
	if chErr == nil {
		t.Fatal("expected CHError for Code: 60 body")
	}
	if chErr.Code != clickhouse.CHUnknownTable {
		t.Errorf("expected CHUnknownTable (60), got %d", chErr.Code)
	}
}

func TestMetricsEndpoint(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool(), nil)
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for /metrics, got %d", w.Code)
	}
}

func TestDefaultQueryLogWindow(t *testing.T) {
	// Explicit from_time is preserved, never clamped.
	req := httptest.NewRequest("GET", "/api/queries?from_time=2020-01-01%2000:00:00", nil)
	got, clamped := defaultQueryLogWindow(req)
	if got != "2020-01-01 00:00:00" || clamped {
		t.Errorf("explicit from_time: got %q clamped=%v, want passthrough", got, clamped)
	}

	// Missing from_time + no_clamp=1 → empty window (caller wants all-time).
	req = httptest.NewRequest("GET", "/api/queries?no_clamp=1", nil)
	got, clamped = defaultQueryLogWindow(req)
	if got != "" || clamped {
		t.Errorf("no_clamp=1: got %q clamped=%v, want empty passthrough", got, clamped)
	}

	// The TS client emits no_clamp=true (String(true)); accept that too.
	req = httptest.NewRequest("GET", "/api/queries?no_clamp=true", nil)
	got, clamped = defaultQueryLogWindow(req)
	if got != "" || clamped {
		t.Errorf("no_clamp=true: got %q clamped=%v, want empty passthrough", got, clamped)
	}

	// Missing from_time, no escape → synthesized 24h window, flagged.
	req = httptest.NewRequest("GET", "/api/queries", nil)
	got, clamped = defaultQueryLogWindow(req)
	if got == "" || !clamped {
		t.Errorf("default: got %q clamped=%v, want synthesized ~24h ago", got, clamped)
	}
}

func TestQueryRoutes_ReturnNon404(t *testing.T) {
	cfg := &config.Config{}
	api := New(clickhouse.NewPool(), nil)
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
		{"GET", "/api/replication"},
		{"GET", "/api/ddl"},
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
