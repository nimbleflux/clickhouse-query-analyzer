package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/api"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

var version = "dev"

//go:embed all:frontend
var frontendEmbed embed.FS

func getFrontendFS() fs.FS {
	sub, _ := fs.Sub(frontendEmbed, "frontend")
	return sub
}

func main() {
	cfg := config.Parse()
	cfg.Version = version

	slog.Info("ClickLens starting",
		"version", version,
		"port", cfg.Port,
		"dev", cfg.DevMode,
		"cors_origin", cfg.CORSOrigin,
	)

	pool := clickhouse.NewPool()
	defer pool.CloseAll()

	if cfg.ClickHouseURL != "" {
		slog.Info("default ClickHouse URL configured", "url", cfg.ClickHouseURL)
	}

	apiHandler := api.New(pool, cfg)
	router := api.Router(cfg, apiHandler, getFrontendFS())

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
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
