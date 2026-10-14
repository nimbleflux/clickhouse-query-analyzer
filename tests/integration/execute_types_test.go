//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// The type matrix below is regression coverage for the editor's native
// protocol row decoding. Every Nullable(T) column used to fail with
// "converting String to ***string is unsupported" because query results were
// scanned into destinations with one pointer level too many; non-nullable
// columns masked the bug, so only queries over nullable data failed.
//
// The table lives in `default` (not the client's system database) and is
// dropped via t.Cleanup.
const typeMatrixDDL = `
CREATE TABLE default.execute_type_matrix_test (
	s      String,
	ns     Nullable(String),
	fs     FixedString(4),
	i64    Int64,
	ni64   Nullable(Int64),
	u64    UInt64,
	nu64   Nullable(UInt64),
	f64    Float64,
	nf64   Nullable(Float64),
	b      Bool,
	nb     Nullable(Bool),
	d      Date,
	nd     Nullable(Date),
	dt     DateTime,
	ndt    Nullable(DateTime),
	dt64   DateTime64(3),
	ndt64  Nullable(DateTime64(3)),
	dec    Decimal(18, 4),
	ndec   Nullable(Decimal(18, 4)),
	uu     UUID,
	nuu    Nullable(UUID),
	ip     IPv4,
	nip    Nullable(IPv4),
	en     Enum8('a' = 1, 'b' = 2),
	nen    Nullable(Enum8('a' = 1, 'b' = 2)),
	lc     LowCardinality(String),
	lcn    LowCardinality(Nullable(String)),
	arr    Array(String),
	narr   Array(Nullable(String)),
	m      Map(String, UInt64),
	tup    Tuple(String, UInt64),
	js     JSON
) ENGINE = Memory`

const typeMatrixInsert = `
INSERT INTO default.execute_type_matrix_test VALUES
	('hello', 'world', 'abcd', -42, -7, 18446744073709551615, 7, 3.14, 2.5,
	 true, false, '2026-01-15', '2026-02-16', '2026-01-15 10:30:00', '2026-02-16 11:45:30',
	 '2026-01-15 10:30:00.123', '2026-02-16 11:45:30.456',
	 '1234.5678', '99.5', '01234567-89ab-cdef-0123-456789abcdef', '7c9e6679-7425-40de-944b-e07fc1f90ae7',
	 '10.0.0.1', '192.168.1.2', 'a', 'b', 'lowcard', 'lcnull',
	 ['x', 'y'], [NULL, 'z'], map('k', 42), ('t1', 99), '{"a": 1, "b": "x"}'),
	('row2', NULL, 'wxyz', 1, NULL, 2, NULL, 3.5, NULL,
	 false, NULL, '2026-03-01', NULL, '2026-03-01 00:00:00', NULL,
	 '2026-03-01 00:00:00.000', NULL,
	 '0.0001', NULL, '01234567-89ab-cdef-0123-456789abcdef', NULL,
	 '10.0.0.2', NULL, 'a', NULL, 'other', NULL,
	 ['p'], [NULL], map(), ('t2', 1), '{"a": 2, "b": "y"}')`

func createTypeMatrixTable(t *testing.T, c *clickhouse.Client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for _, stmt := range []string{
		"DROP TABLE IF EXISTS default.execute_type_matrix_test",
		typeMatrixDDL,
		typeMatrixInsert,
	} {
		if err := c.Conn().Exec(ctx, stmt); err != nil {
			t.Fatalf("setup failed (%s): %v", firstLine(stmt), err)
		}
	}
	t.Cleanup(func() {
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_ = c.Conn().Exec(dropCtx, "DROP TABLE IF EXISTS default.execute_type_matrix_test")
	})
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return s
}

// rowJSON renders one column value the way the browser would receive it.
func rowJSON(t *testing.T, row map[string]any, col string) string {
	t.Helper()
	b, err := json.Marshal(row[col])
	if err != nil {
		t.Fatalf("marshal %s: %v", col, err)
	}
	return string(b)
}

func wantValue(t *testing.T, row map[string]any, col, want string) {
	t.Helper()
	if got := rowJSON(t, row, col); got != want {
		t.Errorf("%s = %s, want %s", col, got, want)
	}
}

func wantNil(t *testing.T, row map[string]any, col string) {
	t.Helper()
	if v, ok := row[col]; v != nil || !ok {
		b, _ := json.Marshal(v)
		t.Errorf("%s = %s, want null", col, b)
	}
}

func wantString(t *testing.T, row map[string]any, col string) {
	t.Helper()
	v, ok := row[col].(string)
	if !ok || v == "" {
		b, _ := json.Marshal(row[col])
		t.Errorf("%s should be a non-empty string, got %s", col, b)
	}
}

// TestExecuteQueryNativeTypeMatrix is the regression test: it must stay on a
// clickhouse:// (native protocol) connection — that is where the decoding
// lives. HTTP has a separate parity test below.
func TestExecuteQueryNativeTypeMatrix(t *testing.T) {
	c := newClient(t)
	createTypeMatrixTable(t, c)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	res, err := c.ExecuteQuery(ctx, clickhouse.ExecuteOptions{
		Query: "SELECT * FROM default.execute_type_matrix_test",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("ExecuteQuery over the native protocol failed: %v", err)
	}
	if res.RowCount != 2 {
		t.Fatalf("row count = %d, want 2", res.RowCount)
	}

	vals, nulls := res.Rows[0], res.Rows[1]

	// Scalar values must survive normalization with value and type intact.
	wantValue(t, vals, "s", `"hello"`)
	wantValue(t, vals, "ns", `"world"`)
	wantValue(t, vals, "i64", `-42`)
	wantValue(t, vals, "ni64", `-7`)
	wantValue(t, vals, "u64", `18446744073709551615`)
	wantValue(t, vals, "nu64", `7`)
	wantValue(t, vals, "f64", `3.14`)
	wantValue(t, vals, "nf64", `2.5`)
	wantValue(t, vals, "b", `true`)
	wantValue(t, vals, "nb", `false`)

	// Nullable columns: real values on row 1, NULLs on row 2. narr is an
	// Array of nullables — the column itself is never NULL, row 2 carries
	// the single-element array [NULL].
	for _, col := range []string{"ns", "ni64", "nu64", "nf64", "nb", "nd",
		"ndt", "ndt64", "ndec", "nuu", "nip", "nen", "lcn"} {
		if res.Rows[0][col] == nil {
			t.Errorf("row 1: %s must not be null", col)
		}
		wantNil(t, nulls, col)
	}
	wantValue(t, nulls, "narr", `[null]`)

	// Strings (incl. driver-typed values that normalize to strings).
	for _, col := range []string{"fs", "d", "dt", "dt64", "dec", "uu", "ip", "en", "lc"} {
		wantString(t, vals, col)
	}
	wantValue(t, vals, "en", `"a"`)
	wantValue(t, vals, "uu", `"01234567-89ab-cdef-0123-456789abcdef"`)
	wantValue(t, vals, "ip", `"10.0.0.1"`)
	wantValue(t, vals, "lcn", `"lcnull"`)
	if got := rowJSON(t, vals, "ndec"); !strings.HasPrefix(got, `"99.5`) {
		t.Errorf("ndec = %s, want a string starting with 99.5", got)
	}

	// Composites render as JSON.
	wantValue(t, vals, "arr", `["x","y"]`)
	wantValue(t, vals, "narr", `[null,"z"]`)
	wantValue(t, vals, "m", `{"k":42}`)
	wantValue(t, vals, "tup", `["t1",99]`)
}

// TestExecuteQueryHTTPParity runs a subset of the matrix through the HTTP
// interface to keep both protocol paths returning compatible shapes.
func TestExecuteQueryHTTPParity(t *testing.T) {
	pool := newPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	c, err := pool.Get(ctx, clickhouse.ConnParams{
		URL:      "http://localhost:18123",
		User:     "default",
		Database: "system",
	})
	if err != nil {
		t.Skipf("HTTP interface not reachable, skipping parity check: %v", err)
	}

	res, err := c.ExecuteQuery(ctx, clickhouse.ExecuteOptions{
		Query: "SELECT 'hello' AS s, toNullable('world') AS ns, -42 AS i64, ['x','y'] AS arr",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("ExecuteQuery over HTTP failed: %v", err)
	}
	if res.RowCount != 1 {
		t.Fatalf("row count = %d, want 1", res.RowCount)
	}
	row := res.Rows[0]
	wantValue(t, row, "s", `"hello"`)
	wantValue(t, row, "ns", `"world"`)
	wantValue(t, row, "i64", `-42`)
	wantValue(t, row, "arr", `["x","y"]`)
}

// TestExecuteQueryEditorNullableEndToEnd mirrors the reported scenario end to
// end through the /api/execute NDJSON endpoint on the native protocol: a
// SELECT whose only column is Nullable(String) used to fail with
// "converting String to ***string is unsupported" (plus a misleading
// "verify your credentials" hint).
func TestExecuteQueryEditorNullableEndToEnd(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	events := executeAndParseStream(t, router, `{"query": "SELECT toNullable('hello') AS survey_title, number AS n FROM system.numbers LIMIT 2"}`)
	result := streamEventOfType(t, events, "result")
	raw, err := json.Marshal(result["result"])
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}

	var res struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		t.Fatalf("unmarshal result payload: %v", err)
	}
	if len(res.Rows) != 2 {
		t.Fatalf("rows = %d, want 2 (payload: %s)", len(res.Rows), raw)
	}
	if got := fmt.Sprint(res.Rows[0]["survey_title"]); got != "hello" {
		t.Errorf("survey_title = %q, want %q", got, "hello")
	}
}

// If decoding ever fails again, the API must report an internal decoding bug,
// not "ClickHouse is unreachable" with a credentials hint.
func TestExecuteQueryErrorNotMisleading(t *testing.T) {
	_, router := setupIntegrationAPI(t)

	// A scan error cannot be fabricated through a real server, so this only
	// checks that ordinary reachable-server errors don't carry the hint and
	// that classification unit tests (internal/api) pin the scan case.
	w := makeReq(t, router, "POST", "/api/execute", chJSONHeaders(), `{"query": "SELECT * FROM default.definitely_missing_table_xyz"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (NDJSON stream), got %d", w.Code)
	}
	for _, line := range strings.Split(strings.TrimSpace(w.Body.String()), "\n") {
		var evt map[string]any
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			t.Fatalf("bad NDJSON line %q: %v", line, err)
		}
		if evt["type"] != "error" {
			continue
		}
		e, _ := json.Marshal(evt["error"])
		if strings.Contains(string(e), "Verify the connection URL") {
			t.Errorf("unknown-table error carries the credentials hint: %s", e)
		}
	}
}

// TestGetTablesNullableTotalRows pins how the table browser renders NULL
// total_rows: system.tables.total_rows is Nullable(UInt64) and Views report
// NULL, and the browser shows the system database where such tables are
// common. A view must surface as 0 rows, never as another table's count.
func TestGetTablesNullableTotalRows(t *testing.T) {
	c := newClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const db = "default_execute_matrix_tmp"
	setup := []string{
		"DROP DATABASE IF EXISTS " + db,
		"CREATE DATABASE " + db,
		"CREATE TABLE " + db + ".counts (x UInt64) ENGINE = Memory",
		"INSERT INTO " + db + ".counts VALUES (1),(2),(3),(4),(5)",
		"CREATE VIEW " + db + ".counts_view AS SELECT 1 AS y",
	}
	for _, stmt := range setup {
		if err := c.Conn().Exec(ctx, stmt); err != nil {
			t.Fatalf("setup failed: %v", err)
		}
	}
	t.Cleanup(func() {
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer dropCancel()
		_ = c.Conn().Exec(dropCtx, "DROP DATABASE IF EXISTS "+db)
	})

	tables, err := c.GetTables(ctx, db)
	if err != nil {
		t.Fatalf("GetTables: %v", err)
	}
	want := map[string]uint64{"counts": 5, "counts_view": 0}
	if len(tables) != len(want) {
		t.Fatalf("got %d tables (%v), want %d", len(tables), tables, len(want))
	}
	for _, tbl := range tables {
		if tbl.RowCount != want[tbl.Name] {
			t.Errorf("table %s: RowCount = %d, want %d", tbl.Name, tbl.RowCount, want[tbl.Name])
		}
	}
}
