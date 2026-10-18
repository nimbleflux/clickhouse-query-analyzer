package config

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
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
	// HideDefaultConnection suppresses the default_connection block in
	// /api/config, so an exposed instance doesn't advertise its internal
	// ClickHouse URL and username to unauthenticated callers.
	HideDefaultConnection bool
	// AuthToken, when set, requires every /api and /metrics request to carry
	// it (Authorization: Bearer … or X-Auth-Token). /health stays open for
	// container healthchecks; static assets stay open so the browser can
	// load the login UI. This is the tool's only application-level auth —
	// without it, anyone who can reach the port can run SQL with the
	// configured ClickHouse credentials.
	AuthToken string
	// QueryTimeout bounds a single ad-hoc statement from the SQL editor
	// (and single-table optimizer analyses). Bulk analysis streams get
	// BulkTimeout instead — they emit progress events the whole time, so
	// they are safe to run much longer behind reverse proxies.
	QueryTimeout time.Duration
	BulkTimeout  time.Duration
}

func Parse() *Config {
	cfg := &Config{}

	flag.IntVar(&cfg.Port, "port", 8080, "HTTP server port")
	flag.StringVar(&cfg.ClickHouseURL, "clickhouse-url", "", "ClickHouse URL (e.g. clickhouse://localhost:9000)")
	flag.StringVar(&cfg.ClickHouseUser, "clickhouse-user", "default", "ClickHouse username")
	flag.StringVar(&cfg.ClickHousePass, "clickhouse-password", "", "ClickHouse password")
	flag.StringVar(&cfg.ClickHouseDB, "clickhouse-db", "system", "ClickHouse database for system tables")
	flag.BoolVar(&cfg.DevMode, "dev", false, "Development mode (serve frontend from web/dist)")
	flag.StringVar(&cfg.CORSOrigin, "cors-origin", "", "Allowed CORS origin (e.g. https://example.com). Empty = same-origin only, * = any origin (without credential headers).")
	flag.DurationVar(&cfg.QueryTimeout, "query-timeout", 120*time.Second, "Per-statement budget for SQL editor queries and single-table analyses")
	flag.DurationVar(&cfg.BulkTimeout, "bulk-analysis-timeout", 30*time.Minute, "Budget for bulk table-analysis streams (they emit progress continuously)")
	flag.BoolVar(&cfg.HideDefaultConnection, "hide-default-connection", false, "Withhold the default connection URL/user from /api/config (for exposed instances)")
	flag.StringVar(&cfg.AuthToken, "auth-token", "", "Require this bearer token on /api and /metrics requests (X-Auth-Token or Authorization: Bearer). Empty = no app-level auth.")
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
	if v := os.Getenv("QUERY_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.QueryTimeout = d
		}
	}
	if v := os.Getenv("BULK_ANALYSIS_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			cfg.BulkTimeout = d
		}
	}
	if v := os.Getenv("AUTH_TOKEN"); v != "" {
		cfg.AuthToken = v
	}

	cfg.ClickHouseURL = strings.TrimSpace(cfg.ClickHouseURL)

	return cfg
}
