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

func Router(cfg *config.Config, api *API, frontendFS fs.FS) http.Handler {
	r := chi.NewRouter()

	r.Use(chiMW.RequestID)
	r.Use(chiMW.RealIP)
	r.Use(chiMW.Recoverer)
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
	r.Post("/processes/{queryID}/kill", api.KillProcess)
	r.Get("/dashboard", api.GetDashboard)

	return r
}

func corsMiddleware(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CH-URL, X-CH-User, X-CH-Password, X-CH-Database, X-CH-Skip-TLS, X-CH-Readonly")
			w.Header().Set("Access-Control-Max-Age", "86400")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
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
		path := r.URL.Path
		if path == "/metrics" || path == "/health" {
			slog.Debug("request",
				"method", r.Method,
				"path", path,
				"status", status,
				"duration", duration.Round(time.Microsecond),
				"req_id", chiMW.GetReqID(r.Context()),
			)
			return
		}
		metrics.HTTPRequestsTotal.WithLabelValues(r.Method, path, strconv.Itoa(status)).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(r.Method, path).Observe(duration.Seconds())
		slog.Info("request",
			"method", r.Method,
			"path", path,
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
