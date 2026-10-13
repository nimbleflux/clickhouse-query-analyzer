package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

type timeoutNetErr struct{ timeout bool }

func (e *timeoutNetErr) Error() string   { return "net timeout" }
func (e *timeoutNetErr) Timeout() bool   { return e.timeout }
func (e *timeoutNetErr) Temporary() bool { return false }

// satisfy net.Error
var _ net.Error = (*timeoutNetErr)(nil)

func TestIsTimeoutErr(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"bare deadline", context.DeadlineExceeded, true},
		{"wrapped deadline", fmt.Errorf("executing query: %w", context.DeadlineExceeded), true},
		{"canceled is not timeout", context.Canceled, false},
		{"net timeout", &timeoutNetErr{timeout: true}, true},
		{"plain error", fmt.Errorf("connection refused"), false},
		{"nil", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isTimeoutErr(tt.err); got != tt.want {
				t.Errorf("isTimeoutErr = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestApiErrorFromErrTimeout(t *testing.T) {
	err := fmt.Errorf("executing query: %w", context.DeadlineExceeded)
	e := apiErrorFromErr(err, 120*time.Second)
	if e.Code != CodeQueryTimeout {
		t.Fatalf("code = %q, want QUERY_TIMEOUT", e.Code)
	}
	if e.status != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504", e.status)
	}
	if e.Hint == "" {
		t.Fatal("timeout error must carry an actionable hint")
	}
	if want := "2m0s"; !strings.Contains(e.Hint, want) {
		t.Fatalf("hint should mention the budget %s: %q", want, e.Hint)
	}
}

func TestApiErrorFromErrServerTimeoutExceeded(t *testing.T) {
	// ClickHouse's own max_execution_time kill arrives as error code 159.
	chErr := &clickhouse.CHError{Code: clickhouse.CHTimeout, Message: "Timeout exceeded while reading table"}
	e := apiErrorFromErr(chErr, 0)
	if e.Code != CodeQueryTimeout {
		t.Fatalf("code = %q, want QUERY_TIMEOUT", e.Code)
	}
	if e.status != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504", e.status)
	}
}

func TestApiErrorFromErrCHException(t *testing.T) {
	chErr := &clickhouse.CHError{Code: clickhouse.CHUnknownTable, Message: "Unknown table t"}
	e := apiErrorFromErr(chErr, 0)
	if e.Code != CodeCHException {
		t.Fatalf("code = %q, want CH_EXCEPTION", e.Code)
	}
	if e.status != http.StatusBadRequest {
		t.Fatalf("syntax-class CH errors should map to 400, got %d", e.status)
	}
}

func TestApiErrorFromErrUnreachable(t *testing.T) {
	e := apiErrorFromErr(fmt.Errorf("dial tcp: connection refused"), 0)
	if e.Code != CodeCHUnreachable {
		t.Fatalf("code = %q, want CH_UNREACHABLE", e.Code)
	}
	if e.status != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", e.status)
	}
}
