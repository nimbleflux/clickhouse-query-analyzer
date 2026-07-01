//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// TestListMutations exercises the system.mutations read path against a real
// ClickHouse (the count is whatever happens to be active — often zero).
func TestListMutations(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ms, err := c.ListMutations(ctx)
	if err != nil {
		t.Fatalf("ListMutations: %v", err)
	}
	// Active set may be empty; we mainly assert the query scans cleanly.
	for _, m := range ms {
		if m.Database == "" || m.Table == "" || m.MutationID == "" {
			t.Errorf("mutation row missing identity fields: %+v", m)
		}
	}
}

func TestListMerges(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ms, err := c.ListMerges(ctx)
	if err != nil {
		t.Fatalf("ListMerges: %v", err)
	}
	for _, m := range ms {
		if m.Database == "" || m.Table == "" {
			t.Errorf("merge row missing identity fields: %+v", m)
		}
	}
}

func TestGetAccess(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	a, err := c.GetAccess(ctx)
	if err != nil {
		t.Fatalf("GetAccess: %v", err)
	}
	if a.CurrentUser == "" {
		t.Error("CurrentUser is empty")
	}
	if a.Users == nil || a.Roles == nil || a.Grants == nil || a.QuotaUsage == nil {
		t.Error("expected non-nil slices even when access tables are restricted")
	}
}

func TestListAsyncMetrics(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	o, err := c.ListAsyncMetrics(ctx)
	if err != nil {
		t.Fatalf("ListAsyncMetrics: %v", err)
	}
	if len(o.Hosts) == 0 {
		t.Error("Hosts is empty — the node indicator needs at least the connected node")
	}
	if len(o.Metrics) == 0 {
		t.Error("expected asynchronous_metrics to return rows")
	}
}

func TestGetTableDDL(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// system.one always exists.
	stmt, err := c.GetTableDDL(ctx, "system", "one")
	if err != nil {
		t.Fatalf("GetTableDDL(system.one): %v", err)
	}
	if !strings.Contains(strings.ToUpper(stmt), "CREATE TABLE") {
		t.Errorf("expected a CREATE TABLE statement, got: %s", stmt)
	}
}

// TestKillQueriesByUser validates the count-then-kill path. It runs against the
// dev cluster as `default`; at the instant of the call there is typically no
// long-running default query, so the count is usually 0 — the assertion is that
// the SQL executes without error.
func TestKillQueriesByUser(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	n, err := c.KillQueriesByUser(ctx, "default")
	if err != nil {
		t.Fatalf("KillQueriesByUser(default): %v", err)
	}
	t.Logf("killed %d queries for user default", n)
}

func TestGetQueryHealthTrend(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pts, err := c.GetQueryHealthTrend(ctx, 24)
	if err != nil {
		t.Fatalf("GetQueryHealthTrend(24h): %v", err)
	}
	for _, p := range pts {
		if p.Bucket.IsZero() {
			t.Errorf("health point missing bucket: %+v", p)
		}
	}
}

// TestListQueries_TableFilter exercises the has(tables, ?) WHERE added for the
// table drill-down. Uses a table the dev workload is known to touch.
func TestListQueries_TableFilter(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	entries, _, err := c.ListQueries(ctx, clickhouse.QueryListParams{
		Table:             "numbers",
		Limit:             5,
		HideSystemQueries: false,
	})
	if err != nil {
		t.Fatalf("ListQueries(table=numbers): %v", err)
	}
	for _, e := range entries {
		found := false
		for _, tbl := range e.Tables {
			if tbl == "numbers" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("entry returned by table filter does not reference 'numbers': tables=%v", e.Tables)
		}
	}
}
