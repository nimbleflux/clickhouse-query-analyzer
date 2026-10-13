package api

import (
	"encoding/json"
	"math"
	"net/http/httptest"
	"testing"
)

// Regression: system.asynchronous_metrics returns NaN on containers (disk
// stats over overlayfs). json.Marshal rejects NaN, and the old writeJSON
// swallowed the error after WriteHeader(200) — producing a 200 with an
// empty body that the frontend failed to parse ("unexpected end of data").
// Any value that can't marshal must now fall back to a well-formed 500.
func TestWriteJSON_UnmarshallableValueFallsBackTo500(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, 200, map[string]any{"value": math.NaN()})
	if w.Code != 500 {
		t.Fatalf("expected 500 on marshal failure, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("fallback body must be valid JSON, got %q: %v", w.Body.String(), err)
	}
	if body["code"] != "INTERNAL" {
		t.Fatalf("expected INTERNAL code, got %v", body["code"])
	}
}

func TestWriteJSON_NilSliceStaysArray(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, 200, []string(nil))
	if w.Body.String() != "[]" {
		t.Fatalf("nil slice must encode as [], got %q", w.Body.String())
	}
}

func TestWriteJSON_PlainValue(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, 200, map[string]string{"status": "ok"})
	if w.Body.String() != "{\"status\":\"ok\"}" {
		t.Fatalf("unexpected body %q", w.Body.String())
	}
}
