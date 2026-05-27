package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
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

	log.Printf("ClickHouse Query Analyzer %s", version)
	log.Printf("  Port: %d", cfg.Port)
	log.Printf("  Dev mode: %v", cfg.DevMode)

	pool := clickhouse.NewPool()
	defer pool.CloseAll()

	if cfg.ClickHouseURL != "" {
		log.Printf("  Default ClickHouse URL: %s", cfg.ClickHouseURL)
	}

	apiHandler := api.New(pool)
	router := api.Router(cfg, apiHandler, getFrontendFS())

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("Server listening on http://localhost:%d", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server shutdown error: %v", err)
	}
	log.Println("Server stopped.")
}
