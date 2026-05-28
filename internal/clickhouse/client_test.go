package clickhouse

import "testing"

func TestIsHTTPScheme(t *testing.T) {
	tests := []struct {
		scheme   string
		expected bool
	}{
		{"http", true},
		{"https", true},
		{"HTTP", false},
		{"clickhouse", false},
		{"", false},
		{"clickhouses", false},
	}

	for _, tt := range tests {
		if got := isHTTPScheme(tt.scheme); got != tt.expected {
			t.Errorf("isHTTPScheme(%q) = %v, want %v", tt.scheme, got, tt.expected)
		}
	}
}

func TestIsNativeScheme(t *testing.T) {
	tests := []struct {
		scheme   string
		expected bool
	}{
		{"clickhouse", true},
		{"clickhouses", true},
		{"", true},
		{"http", false},
		{"https", false},
	}

	for _, tt := range tests {
		if got := isNativeScheme(tt.scheme); got != tt.expected {
			t.Errorf("isNativeScheme(%q) = %v, want %v", tt.scheme, got, tt.expected)
		}
	}
}

func TestIsTLSScheme(t *testing.T) {
	tests := []struct {
		scheme   string
		expected bool
	}{
		{"https", true},
		{"clickhouses", true},
		{"http", false},
		{"clickhouse", false},
		{"", false},
		{"customs", true},
	}

	for _, tt := range tests {
		if got := isTLSScheme(tt.scheme); got != tt.expected {
			t.Errorf("isTLSScheme(%q) = %v, want %v", tt.scheme, got, tt.expected)
		}
	}
}

func TestMustPort(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"9000", 9000},
		{"8123", 8123},
		{"0", 0},
		{"abc", 9000},
		{"", 9000},
	}

	for _, tt := range tests {
		if got := mustPort(tt.input); got != tt.expected {
			t.Errorf("mustPort(%q) = %d, want %d", tt.input, got, tt.expected)
		}
	}
}

func TestConnParamsKey(t *testing.T) {
	p1 := ConnParams{URL: "clickhouse://host:9000", User: "default", Database: "system", SkipTLS: false}
	p2 := ConnParams{URL: "clickhouse://host:9000", User: "default", Database: "system", SkipTLS: false}
	p3 := ConnParams{URL: "clickhouse://host:9000", User: "admin", Database: "system", SkipTLS: false}

	if p1.key() != p2.key() {
		t.Errorf("same params should produce same key")
	}
	if p1.key() == p3.key() {
		t.Errorf("different users should produce different keys")
	}
}

func TestConnParamsKey_PasswordIncluded(t *testing.T) {
	p1 := ConnParams{URL: "clickhouse://host:9000", User: "default", Password: "pass1", Database: "system"}
	p2 := ConnParams{URL: "clickhouse://host:9000", User: "default", Password: "pass2", Database: "system"}

	if p1.key() == p2.key() {
		t.Errorf("different passwords should produce different pool keys")
	}

	p3 := ConnParams{URL: "clickhouse://host:9000", User: "default", Password: "pass1", Database: "system"}
	if p1.key() != p3.key() {
		t.Errorf("same parameters should produce same pool key")
	}
}

func TestNewPool(t *testing.T) {
	pool := NewPool()
	if pool == nil {
		t.Fatal("expected non-nil pool")
	}
	if pool.clients == nil {
		t.Error("expected clients map to be initialized")
	}
}

func TestPoolCloseAll_Empty(t *testing.T) {
	pool := NewPool()
	pool.CloseAll()
}

func TestClient_TableRef(t *testing.T) {
	tests := []struct {
		name        string
		cluster     bool
		clusterName string
		table       string
		expected    string
	}{
		{"single node", false, "", "query_log", "system.query_log"},
		{"cluster", true, "mycluster", "query_log", "clusterAllReplicas('mycluster', system.query_log)"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := &Client{isCluster: tt.cluster, cluster: tt.clusterName}
			if got := c.tableRef(tt.table); got != tt.expected {
				t.Errorf("tableRef() = %q, want %q", got, tt.expected)
			}
		})
	}
}
