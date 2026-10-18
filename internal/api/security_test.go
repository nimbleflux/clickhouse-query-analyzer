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

// TestAuthTokenMiddleware verifies the -auth-token gate: /api without the
// token → 401 UNAUTHORIZED; with the token (either header form) → passes
// through; /health stays open for container healthchecks.
func TestAuthTokenMiddleware(t *testing.T) {
	const token = "s3cret"
	handler := authTokenMiddleware(token)

	assertAuth := func(t *testing.T, w *httptest.ResponseRecorder, wantStatus int, wantCode ApiErrorCode) {
		t.Helper()
		if w.Code != wantStatus {
			t.Fatalf("status = %d, want %d (body: %s)", w.Code, wantStatus, w.Body.String())
		}
		if wantCode != "" {
			var e ApiError
			if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
				t.Fatalf("body is not an ApiError: %v", err)
			}
			if e.Code != wantCode {
				t.Fatalf("code = %q, want %q", e.Code, wantCode)
			}
		}
	}

	// No token → 401.
	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(w, req)
	assertAuth(t, w, 401, CodeUnauthorized)

	// Wrong token → 401.
	req = httptest.NewRequest("GET", "/api/config", nil)
	req.Header.Set("X-Auth-Token", "nope")
	w = httptest.NewRecorder()
	handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(w, req)
	assertAuth(t, w, 401, CodeUnauthorized)

	// Right token via X-Auth-Token → 200.
	req = httptest.NewRequest("GET", "/api/config", nil)
	req.Header.Set("X-Auth-Token", token)
	w = httptest.NewRecorder()
	handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(w, req)
	assertAuth(t, w, 200, "")

	// Right token via Authorization: Bearer → 200.
	req = httptest.NewRequest("GET", "/api/config", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })).ServeHTTP(w, req)
	assertAuth(t, w, 200, "")
}

// TestSecurityHeaders checks the CSP is emitted in production mode and
// skipped in dev mode (Vite HMR needs websockets + transformed sources).
func TestSecurityHeaders(t *testing.T) {
	noop := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	w := httptest.NewRecorder()
	securityHeadersMiddleware(false)(noop).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Header().Get("Content-Security-Policy") == "" {
		t.Error("production mode must emit Content-Security-Policy")
	}

	w = httptest.NewRecorder()
	securityHeadersMiddleware(true)(noop).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Header().Get("Content-Security-Policy") != "" {
		t.Error("dev mode must not emit Content-Security-Policy (breaks Vite HMR)")
	}
}

// TestAuthToken_ScopesToAPIAndMetrics pins the auth-middleware scope: with a
// token configured, /health (container healthchecks) and the SPA root must
// stay reachable — only /api and /metrics are gated. A top-level middleware
// here once 401'd the HTML document itself, so the browser showed a bare 401
// instead of the token dialog.
func TestAuthToken_ScopesToAPIAndMetrics(t *testing.T) {
	cfg := &config.Config{AuthToken: "s3cret"}
	api := New(clickhouse.NewPool(), nil)
	router := Router(cfg, api, nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Errorf("/health with auth enabled = %d, want 200 (healthchecks break otherwise)", w.Code)
	}

	req = httptest.NewRequest("GET", "/", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code == 401 {
		t.Error("/ (SPA) must not be gated — the browser needs the app shell to show the token dialog")
	}

	req = httptest.NewRequest("GET", "/api/config", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Errorf("/api/config without token = %d, want 401", w.Code)
	}
}
