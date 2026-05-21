package api

import (
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/go-chi/chi/v5"
	chiMW "github.com/go-chi/chi/v5/middleware"

	"github.com/bartcode/clickhouse-query-analyzer/internal/config"
)

func Router(cfg *config.Config, api *API, frontendFS fs.FS) http.Handler {
	r := chi.NewRouter()

	r.Use(chiMW.RequestID)
	r.Use(chiMW.RealIP)
	r.Use(chiMW.Recoverer)
	r.Use(chiMW.Logger)
	r.Use(corsMiddleware)

	r.Mount("/api", apiRoutes(api))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	if cfg.DevMode {
		proxyURL, _ := url.Parse("http://localhost:5173")
		proxy := httputil.NewSingleHostReverseProxy(proxyURL)
		r.Handle("/*", proxy)
	} else {
		static(r, frontendFS)
	}

	return r
}

func apiRoutes(api *API) http.Handler {
	r := chi.NewRouter()

	r.Post("/connect", api.Connect)
	r.Post("/execute", api.ExecuteQuery)
	r.Get("/schema", api.GetSchema)
	r.Get("/compare", api.CompareQueries)
	r.Get("/queries", api.ListQueries)
	r.Get("/queries/{queryID}", api.GetQuery)
	r.Get("/queries/{queryID}/metrics", api.GetQueryMetrics)
	r.Get("/queries/{queryID}/threads", api.GetQueryThreads)
	r.Get("/queries/{queryID}/threads/summaries", api.GetThreadSummaries)
	r.Get("/queries/{queryID}/threads/{threadID}/profile", api.GetThreadProfile)
	r.Get("/queries/{queryID}/trace", api.GetTrace)
	r.Get("/queries/{queryID}/flamegraph", api.GetFlameGraph)
	r.Get("/queries/{queryID}/views", api.GetQueryViews)
	r.Post("/queries/{queryID}/explain", api.GetExplain)
	r.Get("/live", api.LiveMonitor)

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
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
