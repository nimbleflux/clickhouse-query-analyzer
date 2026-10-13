package api

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chiMW "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/metrics"
)

const maxRequestBodySize = 1 << 20 // 1 MB

func Router(cfg *config.Config, api *API, frontendFS fs.FS) http.Handler {
	r := chi.NewRouter()

	r.Use(chiMW.RequestID)
	r.Use(chiMW.Recoverer)
	r.Use(securityHeadersMiddleware)
	r.Use(bodyLimitMiddleware)
	r.Use(slogMiddleware)
	r.Use(corsMiddleware(cfg.CORSOrigin))

	r.Get("/metrics", promhttp.Handler().ServeHTTP)
	r.Mount("/api", apiRoutes(api, cfg))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Get("/api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"version": cfg.Version})
	})

	if cfg.DevMode {
		proxyURL, _ := url.Parse("http://localhost:5173")
		proxy := httputil.NewSingleHostReverseProxy(proxyURL)
		return devHandler{api: r, proxy: proxy}
	}

	static(r, frontendFS)

	return r
}

type devHandler struct {
	api   http.Handler
	proxy http.Handler
}

func (h devHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isAPIRequest(r) {
		h.api.ServeHTTP(w, r)
	} else {
		h.proxy.ServeHTTP(w, r)
	}
}

func isAPIRequest(r *http.Request) bool {
	p := r.URL.Path
	return p == "/metrics" || p == "/health" ||
		len(p) >= 5 && p[:5] == "/api/"
}

func apiRoutes(api *API, cfg *config.Config) http.Handler {
	r := chi.NewRouter()

	// A zero/negative bulk timeout would make context.WithTimeout below
	// expire instantly (every request dead on arrival), so floor it.
	bulkTimeout := cfg.BulkTimeout
	if bulkTimeout <= 0 {
		bulkTimeout = 30 * time.Minute
	}
	queryTimeout := cfg.QueryTimeout
	if queryTimeout <= 0 {
		queryTimeout = 120 * time.Second
	}

	// Outermost backstop sized for the longest legal request (a bulk table
	// analysis stream). Tighter budgets apply further in: fast system-table
	// routes get 60s, SQL editor queries bound themselves with -query-timeout
	// per statement, and the optimizer SSE routes run under this backstop
	// because they emit progress events the whole time.
	r.Use(apiTimeout(bulkTimeout))
	// POST bodies must be application/json. Cross-origin "simple requests"
	// (text/plain, no preflight) can otherwise trigger state-changing
	// endpoints like kill/drop/revoke even when CORS headers are absent.
	// /connect is exempt: it has no body and no side effects beyond a probe.
	r.Use(requireJSONContentType)

	// Fast routes: dashboard/list/metadata queries against system tables.
	// 60s is generous for these; a hung request is a server problem the
	// user should hear about, not an indefinite spinner.
	fast := r.With(apiTimeout(60 * time.Second))
	fast.Post("/connect", api.ConnectWithInfo)
	fast.Get("/config", api.GetConfig)
	fast.Get("/schema", api.GetSchema)
	fast.Get("/schema/graph", api.SchemaGraph)
	fast.Get("/schema/{db}/tables", api.GetTables)
	fast.Get("/schema/{db}/{table}/columns", api.GetColumns)
	fast.Get("/schema/{db}/{table}/ddl", api.GetTableDDL)
	fast.Get("/compare", api.CompareQueries)
	fast.Get("/queries", api.ListQueries)
	fast.Get("/queries/fingerprints", api.ListFingerprints)
	fast.Get("/queries/health-trend", api.GetQueryHealthTrend)
	fast.Get("/queries/fingerprints/{hash}/trend", api.GetFingerprintTrend)
	fast.Get("/queries/fingerprints/{hash}/queries", api.ListFingerprintQueries)
	fast.Get("/queries/{queryID}", api.GetQuery)
	fast.Get("/queries/{queryID}/metrics", api.GetQueryMetrics)
	fast.Get("/queries/{queryID}/threads", api.GetQueryThreads)
	fast.Get("/queries/{queryID}/threads/summaries", api.GetThreadSummaries)
	fast.Get("/queries/{queryID}/threads/{threadID}/profile", api.GetThreadProfile)
	fast.Get("/queries/{queryID}/trace", api.GetTrace)
	fast.Get("/queries/{queryID}/flamegraph", api.GetFlameGraph)
	fast.Get("/queries/{queryID}/views", api.GetQueryViews)
	fast.Post("/queries/{queryID}/explain", api.GetExplain)
	// EXPLAIN ANALYZE re-executes the user's query — it needs the query
	// budget, not the fast-system-tables budget.
	r.With(apiTimeout(queryTimeout)).Post("/queries/{queryID}/explain-analyze", api.GetExplainAnalyze)
	// Single-table optimizer analysis can scan a lot of table metadata —
	// same query budget.
	r.With(apiTimeout(queryTimeout)).Get("/optimizer/{db}/{table}", api.AnalyzeTableHandler)
	fast.Get("/processes", api.ListProcesses)
	fast.Post("/processes/kill-by-user", api.KillProcessesByUser)
	fast.Post("/processes/{queryID}/kill", api.KillProcess)
	fast.Get("/dashboard", api.GetDashboard)
	fast.Get("/replication", api.GetReplication)
	fast.Get("/ddl", api.GetDDL)
	fast.Get("/mutations", api.ListMutations)
	fast.Post("/mutations/kill", api.KillMutationHandler)
	fast.Get("/merges", api.ListMerges)
	fast.Get("/access", api.GetAccess)
	fast.Post("/access/users/{user}/drop", api.DropUser)
	fast.Post("/access/roles/{role}/drop", api.DropRole)
	fast.Post("/access/grants/revoke", api.RevokeGrant)
	fast.Get("/access/users/{user}/grants", api.GetUserGrants)
	fast.Get("/access/roles/{role}/grants", api.GetRoleGrants)
	fast.Get("/system-metrics", api.ListAsyncMetrics)
	fast.Get("/advisor/remote-tables", api.RemoteTables)

	// SQL editor execution bounds itself with -query-timeout per statement
	// and streams NDJSON progress events, so it needs the bulk backstop,
	// not the 60s fast budget.
	r.Post("/execute", api.ExecuteQuery)
	r.Post("/execute/count", api.ExecuteCount)
	r.Post("/execute/cancel", api.ExecuteCancel)
	// Detached execution jobs: start, poll, cancel. The query outlives the
	// starting HTTP request, so these routes never need the fast budget.
	r.Get("/jobs", api.ListJobs)
	r.Get("/jobs/{jobID}", api.GetJob)
	r.Post("/jobs/{jobID}/cancel", api.CancelJob)

	// Bulk optimizer analysis streams; single-table analysis self-bounds at
	// -query-timeout (wrapped above), the database/all-database SSE streams
	// run under the bulk backstop.
	r.Get("/optimizer/{db}", api.AnalyzeDatabaseHandler)
	r.Get("/optimizer", api.AnalyzeAllHandler)

	return r
}

func corsMiddleware(origin string) func(http.Handler) http.Handler {
	// When origin is empty, no CORS headers are emitted — requests are
	// same-origin only. When origin is "*", standard headers are allowed but
	// NOT the X-CH-* credential headers (prevents cross-origin CSRF).
	// X-CH-* headers are only advertised for explicit operator-configured origins.
	chHeaders := "Content-Type, Authorization"
	if origin != "" && origin != "*" {
		chHeaders += ", X-CH-URL, X-CH-User, X-CH-Password, X-CH-Database, X-CH-Skip-TLS, X-CH-Readonly"
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", chHeaders)
				w.Header().Set("Access-Control-Max-Age", "86400")
			}

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func bodyLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)
		next.ServeHTTP(w, r)
	})
}

func apiTimeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// requireJSONContentType rejects POST requests that don't declare a JSON
// body (415). A cross-origin attacker can always send a "simple request"
// without triggering CORS preflight — but only with the CORS-safelisted
// content types (text/plain, form-encoded). Demanding application/json
// forces a preflight, which the CORS middleware (same-origin by default)
// refuses, so the write never happens. GETs and bodyless /connect pass.
func requireJSONContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path != "/api/connect" {
			if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				writeJSON(w, http.StatusUnsupportedMediaType, ApiError{
					Message: "POST requests must use Content-Type: application/json",
					Code:    CodeInvalidBody,
					Retry:   false,
				})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func slogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chiMW.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		duration := time.Since(start)
		status := ww.Status()
		if status == 0 {
			status = 200
		}
		rawPath := r.URL.Path
		if rawPath == "/metrics" || rawPath == "/health" {
			slog.Debug("request",
				"method", r.Method,
				"path", rawPath,
				"status", status,
				"duration", duration.Round(time.Microsecond),
				"req_id", chiMW.GetReqID(r.Context()),
			)
			return
		}
		// Use the matched route pattern (e.g. /api/queries/{queryID}) instead
		// of the raw path to prevent Prometheus cardinality explosion from
		// unique query IDs, hashes, etc.
		routePattern := chi.RouteContext(r.Context()).RoutePattern()
		metricsPath := routePattern
		if metricsPath == "" {
			metricsPath = rawPath
		}
		metrics.HTTPRequestsTotal.WithLabelValues(r.Method, metricsPath, strconv.Itoa(status)).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(r.Method, metricsPath).Observe(duration.Seconds())
		slog.Info("request",
			"method", r.Method,
			"path", rawPath,
			"route", metricsPath,
			"status", status,
			"duration", duration.Round(time.Microsecond),
			"req_id", chiMW.GetReqID(r.Context()),
		)
	})
}

func static(r chi.Router, fsys fs.FS) {
	staticFS, _ := fs.Sub(fsys, ".")
	fileServer := http.FileServerFS(staticFS)

	r.Handle("/*", http.StripPrefix("/", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := req.URL.Path
		f, err := staticFS.Open(path)
		if err != nil {
			req.URL.Path = "/"
		} else {
			f.Close()
		}
		fileServer.ServeHTTP(w, req)
	})))
}
