package api

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
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
	r.Use(chiMW.RealIP)
	r.Use(chiMW.Recoverer)
	r.Use(securityHeadersMiddleware)
	r.Use(bodyLimitMiddleware)
	r.Use(slogMiddleware)
	r.Use(corsMiddleware(cfg.CORSOrigin))
	r.Use(apiTimeout(30 * time.Second))

	r.Get("/metrics", promhttp.Handler().ServeHTTP)
	r.Mount("/api", apiRoutes(api))

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

func apiRoutes(api *API) http.Handler {
	r := chi.NewRouter()
	r.Use(apiTimeout(60 * time.Second))

	r.Post("/connect", api.ConnectWithInfo)
	r.Get("/config", api.GetConfig)
	r.Post("/execute", api.ExecuteQuery)
	r.Get("/schema", api.GetSchema)
	r.Get("/schema/{db}/tables", api.GetTables)
	r.Get("/schema/{db}/{table}/columns", api.GetColumns)
	r.Get("/compare", api.CompareQueries)
	r.Get("/queries", api.ListQueries)
	r.Get("/queries/fingerprints", api.ListFingerprints)
	r.Get("/queries/fingerprints/{hash}/trend", api.GetFingerprintTrend)
	r.Get("/queries/fingerprints/{hash}/queries", api.ListFingerprintQueries)
	r.Get("/queries/{queryID}", api.GetQuery)
	r.Get("/queries/{queryID}/metrics", api.GetQueryMetrics)
	r.Get("/queries/{queryID}/threads", api.GetQueryThreads)
	r.Get("/queries/{queryID}/threads/summaries", api.GetThreadSummaries)
	r.Get("/queries/{queryID}/threads/{threadID}/profile", api.GetThreadProfile)
	r.Get("/queries/{queryID}/trace", api.GetTrace)
	r.Get("/queries/{queryID}/flamegraph", api.GetFlameGraph)
	r.Get("/queries/{queryID}/views", api.GetQueryViews)
	r.Post("/queries/{queryID}/explain", api.GetExplain)
	r.Get("/optimizer/{db}/{table}", api.AnalyzeTableHandler)
	r.Get("/optimizer/{db}", api.AnalyzeDatabaseHandler)
	r.Get("/optimizer", api.AnalyzeAllHandler)

	r.Get("/processes", api.ListProcesses)
	r.Post("/processes/kill-by-user", api.KillProcessesByUser)
	r.Post("/processes/{queryID}/kill", api.KillProcess)
	r.Get("/dashboard", api.GetDashboard)
	r.Get("/replication", api.GetReplication)
	r.Get("/ddl", api.GetDDL)
	r.Get("/mutations", api.ListMutations)
	r.Post("/mutations/kill", api.KillMutationHandler)
	r.Get("/merges", api.ListMerges)
	r.Get("/access", api.GetAccess)
	r.Post("/access/users/{user}/drop", api.DropUser)
	r.Post("/access/roles/{role}/drop", api.DropRole)
	r.Post("/access/grants/revoke", api.RevokeGrant)
	r.Get("/system-metrics", api.ListAsyncMetrics)

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
