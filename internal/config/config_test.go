package config

import (
	"os"
	"testing"
)

func TestParse(t *testing.T) {
	if err := os.Setenv("CLICKHOUSE_URL", "  clickhouse://host:9000  "); err != nil {
		t.Fatal(err)
	}
	defer os.Unsetenv("CLICKHOUSE_URL")

	cfg := Parse()

	if cfg.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Port)
	}
	if cfg.DevMode {
		t.Error("expected dev mode to be false by default")
	}
	if cfg.ClickHouseUser != "default" {
		t.Errorf("expected default user 'default', got %s", cfg.ClickHouseUser)
	}
	if cfg.ClickHouseDB != "system" {
		t.Errorf("expected default db 'system', got %s", cfg.ClickHouseDB)
	}
	if cfg.ClickHouseURL != "clickhouse://host:9000" {
		t.Errorf("expected trimmed URL, got %q", cfg.ClickHouseURL)
	}
	if cfg.CORSOrigin != "" {
		t.Errorf("expected default CORS origin '', got %q", cfg.CORSOrigin)
	}
}
