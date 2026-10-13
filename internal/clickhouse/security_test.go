package clickhouse

import "testing"

func TestValidAccessType(t *testing.T) {
	tests := []struct {
		accessType string
		want       bool
	}{
		{"SELECT", true},
		{"INSERT", true},
		{"SELECT, INSERT", true},
		{"SELECT(col1, col2)", true},
		{"alter update", true},
		{"KILL QUERY", true},
		{"ALL", true},
		{"ALL PRIVILEGES", true},
		{"SYSTEM SHUTDOWN", true},
		// The injection: a crafted accessType comment-swallows the fixed
		// `ON ... FROM <grantee>` suffix and revokes arbitrary privileges
		// from arbitrary grantees.
		{"SELECT ON db2.* FROM victim /*", false},
		{"SELECT(col1) -- ", false},
		{"`SELECT`", false},
		{"'; DROP USER x", false},
		{"*.*", false},
		{"", false},
		{"   ", false},
	}
	for _, tt := range tests {
		t.Run(tt.accessType, func(t *testing.T) {
			if got := ValidAccessType(tt.accessType); got != tt.want {
				t.Errorf("ValidAccessType(%q) = %v, want %v", tt.accessType, got, tt.want)
			}
		})
	}
}

func TestIsValidGranteeName(t *testing.T) {
	// The name comes straight from a URL path parameter; anything that isn't
	// a plain identifier must be rejected before SQL is built (there is no
	// quoting that works in the SHOW GRANTS FOR position).
	for _, name := range []string{"alice", "svc-account", "role.db", "user_1"} {
		if !IsValidGranteeName(name) {
			t.Errorf("IsValidGranteeName(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"a`b", "u sers", "x,y", "current_user()", "a'b", ""} {
		if IsValidGranteeName(name) {
			t.Errorf("IsValidGranteeName(%q) = true, want false", name)
		}
	}
}

func TestStripLeadingComments(t *testing.T) {
	tests := []struct{ in, want string }{
		{"SELECT 1", "SELECT 1"},
		{"  -- c\nSELECT 1", "SELECT 1"},
		{"/* c */ SELECT 1", "SELECT 1"},
		{"/* a */ -- b \n\t SELECT 1", "SELECT 1"},
		{"-- unterminated", ""},
		{"/* unterminated", ""},
		{"", ""},
		{"   ", ""},
	}
	for _, tt := range tests {
		if got := StripLeadingComments(tt.in); got != tt.want {
			t.Errorf("StripLeadingComments(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestFilterSettings(t *testing.T) {
	in := map[string]string{
		"max_execution_time":       "300",
		"use_query_cache":          "1",
		"query_plan_read_in_order": "1",
		"log_comment":              "evil", // must be dropped
		"readonly":                 "0",    // not allowed via editor
		"max_threads":              "4",
	}
	out := FilterSettings(in)
	if out == nil {
		t.Fatal("expected surviving settings")
	}
	for _, key := range []string{"max_execution_time", "use_query_cache", "query_plan_read_in_order", "max_threads"} {
		if _, ok := out[key]; !ok {
			t.Errorf("%s should be allowed", key)
		}
	}
	for _, key := range []string{"log_comment", "readonly"} {
		if _, ok := out[key]; ok {
			t.Errorf("%s must be dropped", key)
		}
	}
	if FilterSettings(nil) != nil {
		t.Error("nil in → nil out")
	}
	if FilterSettings(map[string]string{"log_comment": "x"}) != nil {
		t.Error("all-rejected map → nil")
	}
}

func TestRedactURL(t *testing.T) {
	tests := []struct{ in, want string }{
		{"clickhouse://user:password@host:9000", "clickhouse://user@host:9000"},
		{"clickhouse://host:9000", "clickhouse://host:9000"},
		{"not a url", "not a url"},
		{"http://alice@host:8123", "http://alice@host:8123"}, // username only: keep (no secret)
	}
	for _, tt := range tests {
		if got := redactURL(tt.in); got != tt.want {
			t.Errorf("redactURL(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
