//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// setupOptimizerTable creates a plain MergeTree WITHOUT a sampling key and
// with enough rows to cross the sampling threshold (>= 100k) that used to
// emit a failing SAMPLE clause (SAMPLING_NOT_ENABLED) and silently zero
// every data-type recommendation.
func setupOptimizerTable(t *testing.T, c *clickhouse.Client, db, table string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	mustExec := func(q string) {
		t.Helper()
		if err := c.Conn().Exec(ctx, q); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	mustExec("DROP TABLE IF EXISTS " + db + "." + table)
	mustExec(`CREATE TABLE ` + db + "." + table + ` (
		id UInt32,
		region LowCardinality(String),
		payload String
	) ENGINE = MergeTree ORDER BY id`)
	mustExec(`INSERT INTO ` + db + "." + table + `
		SELECT number, 'r' || (number % 7), 'p' || number
		FROM numbers(120000)`)
}

// TestAnalyzeTable_SamplingWithoutSampleKey pins finding 1.2: column
// sampling must produce real stats for tables WITHOUT a SAMPLE BY key —
// before the fix, `SAMPLE 0.01` failed with SAMPLING_NOT_ENABLED and the
// swallowed error left TotalSampled at zero, silently disabling the
// low-cardinality / integer / codec recommenders.
func TestAnalyzeTable_SamplingWithoutSampleKey(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	if err := c.Conn().Exec(ctx, "CREATE DATABASE IF NOT EXISTS optimizer_it"); err != nil {
		t.Fatalf("create db: %v", err)
	}
	setupOptimizerTable(t, c, "optimizer_it", "events_plain")

	analysis, err := c.AnalyzeTable(ctx, "optimizer_it", "events_plain")
	if err != nil {
		t.Fatalf("AnalyzeTable: %v", err)
	}
	if len(analysis.Columns) == 0 {
		t.Fatal("no columns analyzed")
	}
	var sampled int
	for _, col := range analysis.Columns {
		if col.TotalSampled > 0 {
			sampled++
		}
	}
	if sampled == 0 {
		t.Fatalf("no column was sampled (TotalSampled all zero) — sampling is silently failing again: %+v", analysis.Columns)
	}

	// The payload column has max cardinality (unique per row) and region is
	// low-cardinality — both signals depend on working sampling.
	for _, col := range analysis.Columns {
		if col.Name == "region" && col.DistinctCount == 0 {
			t.Errorf("region column sampled but distinct count is 0")
		}
	}
}

// TestAnalyzeTable_QuoteBreakout pins finding 1.1: a database name crafted
// to break out of a single-quoted literal (trailing backslash) must come
// back as a not-found-style error, NOT a syntax error / injected execution.
func TestAnalyzeTable_QuoteBreakout(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// This payload terminates the old quoteStr literal early; with the
	// fixed quoting it is just a (nonexistent) database name.
	const payload = `x\`

	for _, name := range []string{payload, `it's`, `back\slash`} {
		_, err := c.AnalyzeTable(ctx, name, "whatever")
		if err == nil {
			t.Errorf("AnalyzeTable(%q) unexpectedly succeeded", name)
			continue
		}
		// SYNTAX_ERROR would mean the literal was broken out of.
		if strings.Contains(err.Error(), "SYNTAX_ERROR") {
			t.Errorf("AnalyzeTable(%q) produced a syntax error — quote breakout: %v", name, err)
		}
	}
}

// TestLogCommentOverride pins finding 1.3: an editor statement executed via
// ExecuteQuery must NOT carry the connection-level 'clicklens' log_comment,
// and an explicit tag must be applied verbatim.
func TestLogCommentOverride(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := c.ExecuteQuery(ctx, clickhouse.ExecuteOptions{
		Query: "SELECT 1",
	}); err != nil {
		t.Fatalf("execute untagged: %v", err)
	}
	time.Sleep(1500 * time.Millisecond) // query_log flush

	var tagged uint64
	if err := c.Conn().QueryRow(ctx,
		"SELECT count() FROM system.query_log WHERE log_comment = 'clicklens' AND query LIKE 'SELECT * FROM (SELECT 1%' AND type = 'QueryFinish'",
	).Scan(&tagged); err != nil {
		t.Skipf("query_log not readable: %v", err)
	}
	if tagged != 0 {
		t.Errorf("editor query was tagged with the internal log_comment %d time(s) — it will be hidden from the Queries page", tagged)
	}

	if _, err := c.ExecuteQuery(ctx, clickhouse.ExecuteOptions{
		Query:      "SELECT 2",
		LogComment: "my-tag",
	}); err != nil {
		t.Fatalf("execute tagged: %v", err)
	}
	time.Sleep(1500 * time.Millisecond)

	var withTag uint64
	if err := c.Conn().QueryRow(ctx,
		"SELECT count() FROM system.query_log WHERE log_comment = 'my-tag' AND type = 'QueryFinish'",
	).Scan(&withTag); err == nil && withTag == 0 {
		t.Errorf("explicit log_comment tag was not applied")
	}
}

// TestListTableParts pins the parts-explorer API: part rows plus a summary
// that aggregates ALL active parts even when the page is truncated.
func TestListTableParts(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := c.Conn().Exec(ctx, "CREATE DATABASE IF NOT EXISTS optimizer_it"); err != nil {
		t.Fatalf("create db: %v", err)
	}
	if err := c.Conn().Exec(ctx, "DROP TABLE IF EXISTS optimizer_it.parts_it"); err != nil {
		t.Fatalf("drop: %v", err)
	}
	if err := c.Conn().Exec(ctx, `CREATE TABLE optimizer_it.parts_it (
		id UInt32, d Date
	) ENGINE = MergeTree PARTITION BY toYYYYMM(d) ORDER BY id`); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Two monthly partitions, ~3000 rows — enough parts data without
	// tripping max_partitions_per_insert_block.
	if err := c.Conn().Exec(ctx, `INSERT INTO optimizer_it.parts_it
		SELECT number, toDate('2026-01-01') + (number % 60) FROM numbers(3000)`); err != nil {
		t.Fatalf("insert: %v", err)
	}

	parts, summary, err := c.ListTableParts(ctx, "optimizer_it", "parts_it", 1)
	if err != nil {
		t.Fatalf("ListTableParts: %v", err)
	}
	if summary.Parts == 0 {
		t.Fatalf("summary reports 0 parts: %+v", summary)
	}
	if len(parts) != 1 {
		t.Errorf("limit=1 should return exactly 1 part row, got %d", len(parts))
	}
	if summary.Rows != 3000 {
		t.Errorf("summary.Rows = %d, want 3000", summary.Rows)
	}
	if summary.Bytes == 0 {
		t.Errorf("summary.Bytes = 0")
	}
	if len(summary.PerPartition) == 0 {
		t.Errorf("per-partition rollup is empty")
	}
}

// TestListBackups_EmptyShape: a fresh server has no backups — the endpoint
// must report an empty list, not an error (and not null).
func TestListBackups_EmptyShape(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	backups, err := c.ListBackups(ctx, 100)
	if err != nil {
		// system.backups requires no grants on most setups; if this server
		// denies it, the page-level error handling covers it — skip here.
		t.Skipf("system.backups unreadable on this server: %v", err)
	}
	if backups == nil {
		t.Error("backups should be [] not nil")
	}
}

// TestServerTimezone pins the timezone capture used by the display toggle.
func TestServerTimezone(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tz := c.ServerTimezone(ctx)
	if tz == "" {
		t.Fatal("timezone() detection returned empty")
	}
	var want string
	if err := c.Conn().QueryRow(ctx, "SELECT timezone()").Scan(&want); err != nil {
		t.Fatalf("timezone(): %v", err)
	}
	if tz != want {
		t.Errorf("ServerTimezone = %q, want %q", tz, want)
	}
}
