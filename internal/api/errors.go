package api

import (
	"errors"
	"net/http"

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
	writeApiError(w, newApiError(
		status,
		CodeCHUnreachable,
		extractMessage(err, "ClickHouse is unreachable"),
		"Verify the connection URL and credentials in the top connection bar.",
		true,
	))
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
	case clickhouse.CHSyntaxError,
		clickhouse.CHUnknownIdentifier,
		clickhouse.CHUnknownTable,
		clickhouse.CHUnknownDatabase,
		clickhouse.CHUnknownColumn,
		clickhouse.CHUnknownSetting,
		clickhouse.CHMissingColumns,
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

// respondErr is the central dispatch: given any error returned from a
// clickhouse client call, pick the right response shape.
func respondErr(w http.ResponseWriter, err error, isConnect bool) {
	if err == nil {
		return
	}
	if chErr, isNotFound := clickhouse.Classify(err); chErr != nil {
		if isNotFound {
			NotFound(w, "resource")
			return
		}
		CHException(w, err)
		return
	}
	// Plain transport / auth failure.
	CHUnreachable(w, isConnect, err)
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
