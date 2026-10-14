package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// ApiErrorCode is a short machine-readable string that the frontend can
// branch on. It is intentionally narrower than HTTP status — many
// distinct 400-class errors all map to different codes.
type ApiErrorCode string

const (
	CodeMissingParam  ApiErrorCode = "MISSING_PARAM"
	CodeInvalidParam  ApiErrorCode = "INVALID_PARAM"
	CodeInvalidBody   ApiErrorCode = "INVALID_BODY"
	CodeNotFound      ApiErrorCode = "NOT_FOUND"
	CodeForbidden     ApiErrorCode = "FORBIDDEN"
	CodeCHUnreachable ApiErrorCode = "CH_UNREACHABLE"
	CodeCHException   ApiErrorCode = "CH_EXCEPTION"
	CodeQueryTimeout  ApiErrorCode = "QUERY_TIMEOUT"
	CodeInternal      ApiErrorCode = "INTERNAL"
)

// ApiError is the JSON-serialisable error payload. All error responses
// (including legacy writeError callers) end up as this shape.
//
// JSON layout:
//
//	{
//	  "error":  "human-readable message",
//	  "code":   "MACHINE_CODE",
//	  "hint":   "optional actionable suggestion",
//	  "retry":  false
//	}
type ApiError struct {
	Message string       `json:"error"`
	Code    ApiErrorCode `json:"code"`
	Hint    string       `json:"hint,omitempty"`
	Retry   bool         `json:"retry"`
	status  int          // unexported, set by helper
}

func (e *ApiError) Error() string { return e.Message }

// helper constructors ---------------------------------------------------------

func newApiError(status int, code ApiErrorCode, msg, hint string, retry bool) *ApiError {
	return &ApiError{Message: msg, Code: code, Hint: hint, Retry: retry, status: status}
}

// MissingParam responds 400 — a required request parameter was absent.
func MissingParam(w http.ResponseWriter, what string) {
	writeApiError(w, newApiError(
		http.StatusBadRequest,
		CodeMissingParam,
		what+" is required",
		"",
		false,
	))
}

// InvalidParam responds 400 — a parameter was present but malformed.
func InvalidParam(w http.ResponseWriter, what, hint string) {
	writeApiError(w, newApiError(
		http.StatusBadRequest,
		CodeInvalidParam,
		"invalid "+what,
		hint,
		false,
	))
}

// InvalidBody responds 400 — request body could not be parsed.
func InvalidBody(w http.ResponseWriter, detail string) {
	msg := "invalid request body"
	if detail != "" {
		msg += ": " + detail
	}
	writeApiError(w, newApiError(
		http.StatusBadRequest,
		CodeInvalidBody,
		msg,
		"",
		false,
	))
}

// Forbidden responds 403 — the operation is blocked (e.g. read-only mode).
func Forbidden(w http.ResponseWriter, msg string) {
	writeApiError(w, newApiError(
		http.StatusForbidden,
		CodeForbidden,
		msg,
		"",
		false,
	))
}

// NotFound responds 404 — the resource identified by the request does not
// exist on the connected ClickHouse instance.
func NotFound(w http.ResponseWriter, what string) {
	writeApiError(w, newApiError(
		http.StatusNotFound,
		CodeNotFound,
		what+" not found",
		"",
		false,
	))
}

// CHUnreachable responds 400 for /connect or 502 everywhere else — the
// configured ClickHouse URL is unreachable or rejected credentials.
func CHUnreachable(w http.ResponseWriter, isConnect bool, err error) {
	status := http.StatusBadGateway
	if isConnect {
		status = http.StatusBadRequest
	}
	hint := "Verify the connection URL and credentials in the top connection bar."
	// A refused connection is a wrong host/port, not a credentials problem —
	// say so, and point at the dev-stack ports people actually run.
	if isRefusedErr(err) {
		hint = "Connection refused — nothing is listening on that host:port. Check the URL. The dev compose stack listens on clickhouse://localhost:19000 (native) or http://localhost:18123 (HTTP)."
	}
	writeApiError(w, newApiError(
		status,
		CodeCHUnreachable,
		extractMessage(err, "ClickHouse is unreachable"),
		hint,
		true,
	))
}

// isRefusedErr detects TCP "connection refused" anywhere in the error chain.
func isRefusedErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "connection refused")
}

// CHException responds 502 (or 400 for syntax errors) — ClickHouse
// returned a server-side exception. Classify picks the HTTP status.
func CHException(w http.ResponseWriter, err error) {
	chErr, _ := clickhouse.Classify(err)
	if chErr == nil {
		// Should not happen, but degrade gracefully.
		Internal(w, err)
		return
	}

	status := http.StatusBadGateway
	hint := ""
	switch chErr.Code {
	// CHMissingColumns shares 47 with CHUnknownIdentifier upstream, so one
	// case covers both.
	case clickhouse.CHSyntaxError,
		clickhouse.CHUnknownIdentifier,
		clickhouse.CHUnknownTable,
		clickhouse.CHUnknownDatabase,
		clickhouse.CHUnknownSetting,
		clickhouse.CHUnknownAggregateFunction,
		clickhouse.CHUnknownFormat:
		status = http.StatusBadRequest
	}
	writeApiError(w, &ApiError{
		Message: chErr.Message,
		Code:    CodeCHException,
		Hint:    hint,
		Retry:   chErr.IsRetryable(),
		status:  status,
	})
}

// Internal responds 500 — an unexpected error in our code or in the
// ClickHouse driver that we couldn't classify.
func Internal(w http.ResponseWriter, err error) {
	writeApiError(w, newApiError(
		http.StatusInternalServerError,
		CodeInternal,
		extractMessage(err, "internal server error"),
		"",
		false,
	))
}

// QueryTimeout responds 504 — the query exceeded its budget (either the
// -query-timeout deadline or a server-side max_execution_time). This is
// NOT a connection problem: ClickHouse answered, the query was just slow.
func QueryTimeout(w http.ResponseWriter, err error, budget time.Duration) {
	msg := "Query exceeded its time budget"
	if err != nil {
		msg = extractMessage(err, msg)
	}
	hint := "Add a LIMIT or a more selective WHERE, or raise the budget with -query-timeout."
	if budget > 0 {
		hint = fmt.Sprintf("The query ran longer than the %s budget. Add a LIMIT or a more selective WHERE, or raise the budget with -query-timeout.", budget)
	}
	writeApiError(w, newApiError(
		http.StatusGatewayTimeout,
		CodeQueryTimeout,
		msg,
		hint,
		true,
	))
}

// isTimeoutErr reports whether err is a local deadline/cancellation timeout
// (as opposed to a ClickHouse-side exception, which Classify handles).
func isTimeoutErr(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return false
}

// ResultDecode responds 500 — the query executed but the result set could
// not be decoded into rows. This is a bug in this tool or its driver, never
// a connection problem: ClickHouse answered and produced data, so the
// "verify credentials" hint would be wrong here.
func ResultDecode(w http.ResponseWriter, err error) {
	writeApiError(w, newApiError(
		http.StatusInternalServerError,
		CodeInternal,
		extractMessage(err, "failed to read the query result"),
		"The query ran, but the result could not be decoded — this looks like a bug in this tool, not a connection or credentials problem. Please report it, including the query and the columns it returns.",
		false,
	))
}

// respondErr is the central dispatch: given any error returned from a
// clickhouse client call, pick the right response shape.
func respondErr(w http.ResponseWriter, err error, isConnect bool) {
	if err == nil {
		return
	}
	if clickhouse.IsResultReadError(err) {
		ResultDecode(w, err)
		return
	}
	if chErr, isNotFound := clickhouse.Classify(err); chErr != nil {
		if isNotFound {
			NotFound(w, "resource")
			return
		}
		if chErr.Code == clickhouse.CHTimeout {
			QueryTimeout(w, err, 0)
			return
		}
		CHException(w, err)
		return
	}
	// Local deadline exceeded (our -query-timeout / route budgets): a slow
	// query is not an unreachable server — say so precisely.
	if isTimeoutErr(err) {
		QueryTimeout(w, err, 0)
		return
	}
	// Plain transport / auth failure.
	CHUnreachable(w, isConnect, err)
}

// apiErrorFromErr mirrors respondErr's dispatch but returns the payload
// instead of writing it — used by the streaming execute handler, which
// must serialize errors as NDJSON events after the response head is sent.
func apiErrorFromErr(err error, budget time.Duration) *ApiError {
	if clickhouse.IsResultReadError(err) {
		return newApiError(http.StatusInternalServerError, CodeInternal,
			extractMessage(err, "failed to read the query result"),
			"The query ran, but the result could not be decoded — this looks like a bug in this tool, not a connection or credentials problem. Please report it, including the query and the columns it returns.",
			false)
	}
	if chErr, isNotFound := clickhouse.Classify(err); chErr != nil {
		if isNotFound {
			return newApiError(http.StatusNotFound, CodeNotFound, "resource not found", "", false)
		}
		if chErr.Code == clickhouse.CHTimeout {
			return timeoutApiError(err, budget)
		}
		status := http.StatusBadGateway
		switch chErr.Code {
		case clickhouse.CHSyntaxError,
			clickhouse.CHUnknownIdentifier,
			clickhouse.CHUnknownTable,
			clickhouse.CHUnknownDatabase,
			clickhouse.CHUnknownSetting,
			clickhouse.CHUnknownAggregateFunction,
			clickhouse.CHUnknownFormat:
			status = http.StatusBadRequest
		}
		return &ApiError{Message: chErr.Message, Code: CodeCHException, Retry: chErr.IsRetryable(), status: status}
	}
	if isTimeoutErr(err) {
		return timeoutApiError(err, budget)
	}
	return newApiError(http.StatusBadGateway, CodeCHUnreachable,
		extractMessage(err, "ClickHouse is unreachable"),
		"Verify the connection URL and credentials in the top connection bar.", true)
}

func timeoutApiError(err error, budget time.Duration) *ApiError {
	e := newApiError(http.StatusGatewayTimeout, CodeQueryTimeout,
		extractMessage(err, "Query exceeded its time budget"), "", true)
	if budget > 0 {
		e.Hint = fmt.Sprintf("The query ran longer than the %s budget. Add a LIMIT or a more selective WHERE, or raise the budget with -query-timeout.", budget)
	} else {
		e.Hint = "Add a LIMIT or a more selective WHERE, or raise the budget with -query-timeout."
	}
	return e
}

// writeApiError serialises an ApiError to the ResponseWriter.
func writeApiError(w http.ResponseWriter, e *ApiError) {
	status := e.status
	if status == 0 {
		status = http.StatusInternalServerError
	}
	writeJSON(w, status, e)
}

func extractMessage(err error, fallback string) string {
	if err == nil {
		return fallback
	}
	msg := err.Error()
	if msg == "" {
		return fallback
	}
	return msg
}

// guard against unused-symbol warnings while bootstrapping the migration;
// these will be wired into handlers as we touch them.
var (
	_ = errors.New
)
