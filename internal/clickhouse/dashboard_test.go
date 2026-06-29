package clickhouse

import "testing"

func TestParseMergeTreeUint(t *testing.T) {
	cases := []struct {
		in   string
		want uint64
		ok   bool
	}{
		{"300", 300, true},
		{"  150 ", 150, true},
		{"0", 0, true},
		{"", 0, false},
		{"not-a-number", 0, false},
	}
	for _, c := range cases {
		got, err := parseMergeTreeUint(c.in)
		if c.ok && err != nil {
			t.Errorf("parseMergeTreeUint(%q) unexpected error: %v", c.in, err)
			continue
		}
		if !c.ok && err == nil {
			t.Errorf("parseMergeTreeUint(%q) expected error, got %d", c.in, got)
			continue
		}
		if c.ok && got != c.want {
			t.Errorf("parseMergeTreeUint(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}
