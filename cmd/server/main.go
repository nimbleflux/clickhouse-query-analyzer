package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/api"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

var version = "dev"

// getFrontendFS returns the embedded production frontend assets. In dev mode
// (the `-tags noembed` build) it returns a tiny stub — see embed_dev.go —
// because dev mode reverse-proxies to the Vite dev server and never serves
// the embed (internal/api/router.go). The stub skips the 38 MB embed on
// every `go run`, which is pure waste in dev.

func main() {
	cfg := config.Parse()
	cfg.Version = version

	slog.Info("ClickLens starting",
		"version", version,
		"port", cfg.Port,
		"dev", cfg.DevMode,
		"cors_origin", cfg.CORSOrigin,
	)

	if cfg.CORSOrigin == "*" && cfg.ClickHouseURL != "" {
		// With CORS_ORIGIN=*, any web page can read API responses
		// cross-origin, and unauthenticated requests fall back to the
		// server-side default credentials — full read/write access from
		// any origin. Operators must opt into that consciously.
		slog.Warn("CORS_ORIGIN=* combined with a server-side default ClickHouse URL: " +
			"any website can run queries against your ClickHouse through this instance. " +
			"Set CORS_ORIGIN to an explicit origin, or drop the default URL.")
	}

	if cfg.ClickHouseURL != "" {
		// Redact userinfo — the default URL may embed a password.
		if u, err := url.Parse(cfg.ClickHouseURL); err == nil && u.User != nil {
			u.User = url.User(u.User.Username())
			slog.Info("default ClickHouse URL configured", "url", u.String())
		} else {
			slog.Info("default ClickHouse URL configured", "url", cfg.ClickHouseURL)
		}
	}

	pool := clickhouse.NewPool()
	defer pool.CloseAll()

	apiHandler := api.New(pool, cfg)
	router := api.Router(cfg, apiHandler, getFrontendFS())

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: router,
		// ReadTimeout bounds request reads; IdleTimeout reaps keep-alive
		// connections. WriteTimeout is deliberately 0: response writing is
		// bounded by per-request context deadlines (query-timeout /
		// bulk-analysis-timeout), and a server-level write deadline would
		// silently kill long-running queries and SSE streams mid-flight.
		// ReadHeaderTimeout caps slow-loris header attacks.
		ReadTimeout:       30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		slog.Info("server listening", "addr", fmt.Sprintf("http://localhost:%d", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
