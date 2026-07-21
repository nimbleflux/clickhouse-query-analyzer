package clickhouse

import "testing"

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
