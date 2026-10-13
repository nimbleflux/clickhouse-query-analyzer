package clickhouse

import (
	"encoding/json"
	"math"
	"testing"
)

// Regression: several system.asynchronous_metrics are NaN on containers
// (disk stats over overlayfs). JSON cannot represent NaN, and a marshal
// failure used to swallow the whole System Metrics response.
func TestFiniteFloatMarshal(t *testing.T) {
	tests := []struct {
		in   finiteFloat
		want string
	}{
		{finiteFloat(math.NaN()), "null"},
		{finiteFloat(math.Inf(1)), "null"},
		{finiteFloat(math.Inf(-1)), "null"},
		{finiteFloat(0), "0"},
		{finiteFloat(1.5), "1.5"},
		{finiteFloat(283608714552), "283608714552"},
	}
	for _, tt := range tests {
		b, err := json.Marshal(tt.in)
		if err != nil {
			t.Fatalf("marshal(%v): %v", tt.in, err)
		}
		if string(b) != tt.want {
			t.Errorf("marshal(%v) = %s, want %s", tt.in, b, tt.want)
		}
	}
}

func TestAsyncMetricMarshalWithNaN(t *testing.T) {
	b, err := json.Marshal(AsyncMetric{
		Host:   "clickhouse",
		Metric: "DiskAvailable",
		Value:  finiteFloat(math.NaN()),
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if v, ok := m["value"]; !ok || v != nil {
		t.Fatalf("NaN value must marshal to null, got %v", m["value"])
	}
}
