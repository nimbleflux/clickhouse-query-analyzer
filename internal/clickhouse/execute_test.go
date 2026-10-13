package clickhouse

import (
	"strings"
	"testing"
)

func TestNativeToHTTPPort(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"9000", "8123"},
		{"", "8123"},
		{"9440", "8443"},
		{"19000", "18123"},
		{"invalid", "8123"},
	}

	for _, tt := range tests {
		if got := nativeToHTTPPort(tt.input); got != tt.expected {
			t.Errorf("nativeToHTTPPort(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestColumnsFromNamesTypes(t *testing.T) {
	tests := []struct {
		name     string
		names    []string
		types    []string
		expected []ColumnInfo
	}{
		{
			"names and types match",
			[]string{"id", "name"},
			[]string{"UInt64", "String"},
			[]ColumnInfo{{Name: "id", Type: "UInt64"}, {Name: "name", Type: "String"}},
		},
		{
			"nil types",
			[]string{"id", "name"},
			nil,
			[]ColumnInfo{{Name: "id", Type: ""}, {Name: "name", Type: ""}},
		},
		{
			"fewer types than names",
			[]string{"id", "name", "value"},
			[]string{"UInt64"},
			[]ColumnInfo{{Name: "id", Type: "UInt64"}, {Name: "name", Type: ""}, {Name: "value", Type: ""}},
		},
		{
			"empty",
			[]string{},
			[]string{},
			[]ColumnInfo{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := columnsFromNamesTypes(tt.names, tt.types)
			if len(got) != len(tt.expected) {
				t.Fatalf("expected %d columns, got %d", len(tt.expected), len(got))
			}
			for i, col := range got {
				if col.Name != tt.expected[i].Name || col.Type != tt.expected[i].Type {
					t.Errorf("column %d: got {%s, %s}, want {%s, %s}", i, col.Name, col.Type, tt.expected[i].Name, tt.expected[i].Type)
				}
			}
		})
	}
}

func TestIsProbablyJSON(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{`{"key": "value"}`, true},
		{`[1, 2, 3]`, true},
		{`  {"key": "value"}  `, true},
		{`  [1, 2, 3]  `, true},
		{"plain text", false},
		{"", false},
		{"   ", false},
		{"<xml>", false},
	}

	for _, tt := range tests {
		if got := isProbablyJSON(tt.input); got != tt.expected {
			t.Errorf("isProbablyJSON(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}

func TestIsSelectLike(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  bool
	}{
		{"plain select", "SELECT 1", true},
		{"select lowercase", "select * from t", true},
		{"with clause", "WITH x AS (SELECT 1) SELECT * FROM x", true},
		{"show", "SHOW TABLES", true},
		{"describe", "DESCRIBE TABLE t", true},
		{"leading line comment", "-- hello\nSELECT 1", true},
		{"leading block comment", "/* tag */ SELECT 1", true},
		{"ddl_entry block comment on select", "/* ddl_entry=q-1 */ SELECT 1", true},
		{"block then line comment", "/* a */\n-- b\nSELECT 1", true},
		{"unterminated block comment", "/* never ends SELECT 1", false},
		{"unterminated line comment", "-- never ends", false},
		{"drop table", "DROP TABLE t", false},
		{"ddl_entry block comment on drop", "/* ddl_entry=query-0000389051 */ DROP TABLE IF EXISTS analytics.events SYNC", false},
		{"create", "CREATE TABLE t (x Int32)", false},
		{"insert select", "INSERT INTO t SELECT * FROM s", false},
		{"alter", "ALTER TABLE t ADD COLUMN x Int32", false},
		{"empty", "", false},
		{"whitespace only", "   \n\t  ", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSelectLike(tt.query); got != tt.want {
				t.Errorf("isSelectLike(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestPrepareExecutedQueryWrapsSelects(t *testing.T) {
	executed, wrapped, hasFormat := prepareExecutedQuery("SELECT * FROM t", 100, 20)
	if !wrapped {
		t.Fatalf("SELECT should be wrapped, got verbatim %q", executed)
	}
	if hasFormat {
		t.Fatal("no FORMAT clause present")
	}
	want := "SELECT * FROM (\nSELECT * FROM t\n) LIMIT 100 OFFSET 20"
	if executed != want {
		t.Fatalf("got %q, want %q", executed, want)
	}
}

func TestPrepareExecutedQueryTrailingLineComment(t *testing.T) {
	// A trailing -- comment must not comment out the closing paren / LIMIT.
	executed, wrapped, _ := prepareExecutedQuery("SELECT a FROM t -- fetch all", 50, 0)
	if !wrapped {
		t.Fatalf("expected wrapping, got %q", executed)
	}
	if !strings.HasSuffix(executed, ") LIMIT 50 OFFSET 0") {
		t.Fatalf("LIMIT suffix was commented out: %q", executed)
	}
	if !strings.Contains(executed, "\n) LIMIT") {
		t.Fatalf("closing paren must sit on its own line after the comment: %q", executed)
	}
}

func TestPrepareExecutedQueryTrailingSemicolon(t *testing.T) {
	executed, wrapped, _ := prepareExecutedQuery("SELECT 1;;  \n", 10, 0)
	if !wrapped {
		t.Fatalf("expected wrapping, got %q", executed)
	}
	if strings.Contains(executed, ";") {
		t.Fatalf("semicolon must be stripped inside the subquery: %q", executed)
	}
}

func TestPrepareExecutedQueryFormatRunsVerbatim(t *testing.T) {
	for _, q := range []string{
		"SELECT * FROM t FORMAT Pretty",
		"SELECT * FROM t\nFORMAT Vertical",
	} {
		executed, wrapped, hasFormat := prepareExecutedQuery(q, 10, 0)
		if wrapped {
			t.Errorf("%q must not be wrapped", q)
		}
		if !hasFormat {
			t.Errorf("%q: FORMAT clause not detected", q)
		}
		if executed != q {
			t.Errorf("FORMAT query must run verbatim: got %q", executed)
		}
	}
}

func TestPrepareExecutedQueryShowGrantsVerbatim(t *testing.T) {
	executed, wrapped, _ := prepareExecutedQuery("SHOW GRANTS FOR user1", 10, 0)
	if wrapped || executed != "SHOW GRANTS FOR user1" {
		t.Fatalf("SHOW GRANTS must run verbatim, got wrapped=%v %q", wrapped, executed)
	}
}

func TestPrepareExecutedQueryNonSelectVerbatim(t *testing.T) {
	executed, wrapped, _ := prepareExecutedQuery("DROP TABLE t", 10, 0)
	if wrapped || executed != "DROP TABLE t" {
		t.Fatalf("non-SELECT must run verbatim, got wrapped=%v %q", wrapped, executed)
	}
}

func TestPrepareExecutedQueryLeadingCommentStillWraps(t *testing.T) {
	// Leading comments are stripped for classification; the query itself
	// should still be wrapped.
	executed, wrapped, _ := prepareExecutedQuery("/* hint */ SELECT 1", 10, 0)
	if !wrapped {
		t.Fatalf("leading comment must not prevent wrapping: %q", executed)
	}
	if !strings.Contains(executed, "/* hint */ SELECT 1") {
		t.Fatalf("query body altered: %q", executed)
	}
}

func TestNewQueryID(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := NewQueryID()
		if len(id) != 32 {
			t.Fatalf("query id should be 32 hex chars, got %q", id)
		}
		if seen[id] {
			t.Fatalf("duplicate query id %q", id)
		}
		seen[id] = true
	}
}

func TestCountQueryRowsRejectsNonSelect(t *testing.T) {
	c := &Client{}
	for _, q := range []string{"DROP TABLE t", "SELECT 1 FORMAT Pretty", "SHOW GRANTS"} {
		n, err := c.CountQueryRows(nil, q)
		if err != nil {
			t.Fatalf("%q: unexpected error %v", q, err)
		}
		if n != -1 {
			t.Fatalf("%q: want -1, got %d", q, n)
		}
	}
}
