package config

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Port           int
	ClickHouseURL  string
	ClickHouseUser string
	ClickHousePass string
	ClickHouseDB   string
	DevMode        bool
	Version        string
	CORSOrigin     string
}

func Parse() *Config {
	cfg := &Config{}

	flag.IntVar(&cfg.Port, "port", 8080, "HTTP server port")
	flag.StringVar(&cfg.ClickHouseURL, "clickhouse-url", "", "ClickHouse URL (e.g. clickhouse://localhost:9000)")
	flag.StringVar(&cfg.ClickHouseUser, "clickhouse-user", "default", "ClickHouse username")
	flag.StringVar(&cfg.ClickHousePass, "clickhouse-password", "", "ClickHouse password")
	flag.StringVar(&cfg.ClickHouseDB, "clickhouse-db", "system", "ClickHouse database for system tables")
	flag.BoolVar(&cfg.DevMode, "dev", false, "Development mode (serve frontend from web/dist)")
	flag.StringVar(&cfg.CORSOrigin, "cors-origin", "*", "Allowed CORS origin (e.g. https://example.com or * for any)")
	flag.Parse()

	if v := os.Getenv("CLICKHOUSE_URL"); v != "" {
		cfg.ClickHouseURL = v
	}
	if v := os.Getenv("CLICKHOUSE_USER"); v != "" {
		cfg.ClickHouseUser = v
	}
	if v := os.Getenv("CLICKHOUSE_PASSWORD"); v != "" {
		cfg.ClickHousePass = v
	}
	if v := os.Getenv("CLICKHOUSE_DB"); v != "" {
		cfg.ClickHouseDB = v
	}
	if v := os.Getenv("PORT"); v != "" {
		fmt.Sscanf(v, "%d", &cfg.Port)
	}
	if v := os.Getenv("CORS_ORIGIN"); v != "" {
		cfg.CORSOrigin = v
	}

	cfg.ClickHouseURL = strings.TrimSpace(cfg.ClickHouseURL)

	return cfg
}
