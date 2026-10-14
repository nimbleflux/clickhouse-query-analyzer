package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// The exact shape of the field report: the editor ran a SELECT with a
// Nullable(String) column over the native protocol and the driver rejected
// our scan destination. executeQueryNative wraps the rows.Scan failure in a
// ResultReadError, which is what the API layer keys on.
func scanRowError() error {
	return &clickhouse.ResultReadError{Err: fmt.Errorf("scanning row: %w",
		fmt.Errorf("clickhouse [ScanRow]: (survey_title) converting String to ***string is unsupported"))}
}

// A result-decoding failure is an internal bug: it must not be reported as
// CH_UNREACHABLE with the "verify credentials" hint.
func TestApiErrorFromErrResultReadError(t *testing.T) {
	e := apiErrorFromErr(scanRowError(), 0)
	if e.Code != CodeInternal {
		t.Fatalf("code = %q, want INTERNAL", e.Code)
	}
	if e.status != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", e.status)
	}
	if e.Message == "" || !strings.Contains(e.Message, "survey_title") {
		t.Fatalf("message should preserve the driver detail: %q", e.Message)
	}
	if strings.Contains(e.Hint, "Verify the connection URL") {
		t.Fatalf("credentials hint leaked into a decode error: %q", e.Hint)
	}
	if !strings.Contains(e.Hint, "bug") {
		t.Fatalf("hint should say this is a tool bug: %q", e.Hint)
	}
}

func TestRespondErrResultReadError(t *testing.T) {
	w := httptest.NewRecorder()
	respondErr(w, scanRowError(), false)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"INTERNAL"`) {
		t.Fatalf("body should carry code INTERNAL: %s", body)
	}
	if strings.Contains(body, "Verify the connection URL") {
		t.Fatalf("credentials hint leaked into a decode error: %s", body)
	}
}

// A result-read wrapper around a server exception still decodes as an
// internal error (the wrapper wins), but a bare mid-stream server exception
// must keep its CH_EXCEPTION classification.
func TestRespondErrServerExceptionStillException(t *testing.T) {
	if !clickhouse.IsResultReadError(&clickhouse.ResultReadError{Err: errors.New("x")}) {
		t.Fatal("IsResultReadError must see through the wrapper")
	}
	if clickhouse.IsResultReadError(errors.New("connection refused")) {
		t.Fatal("plain transport error misclassified as result-read")
	}

	chExc := &clickhouse.CHError{Code: clickhouse.CHMemoryLimit, Message: "Memory limit exceeded"}
	w := httptest.NewRecorder()
	respondErr(w, fmt.Errorf("iterating rows: %w", chExc), false)
	if !strings.Contains(w.Body.String(), `"CH_EXCEPTION"`) {
		t.Fatalf("server exception should stay CH_EXCEPTION: %s", w.Body.String())
	}
}
