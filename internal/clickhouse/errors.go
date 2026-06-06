package clickhouse

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	ch "github.com/ClickHouse/clickhouse-go/v2"
)

// Sentinels for common ClickHouse-driven conditions that the API layer
// wants to translate into specific HTTP responses (e.g. 404 vs 500).
var (
	// ErrNotFound is returned when a query for a specific row by primary
	// identifier (e.g. a query_id) returned no rows.
	ErrNotFound = errors.New("not found")
)

// ClickHouseErrorCode is a strongly-typed wrapper around the numeric error
// code that ClickHouse includes with every server-side exception.
//
// See: https://clickhouse.com/docs/en/guides/developer/faq#errors
type ClickHouseErrorCode int32

// Well-known ClickHouse error codes used by the API layer to populate
// the structured `code` field. This list is intentionally short; any
// unrecognised code falls back to "CH_EXCEPTION".
//
// Reference: https://github.com/ClickHouse/ClickHouse/blob/master/src/Common/ErrorCodes.cpp
const (
	CHUnknown                   ClickHouseErrorCode = 0
	CHUnsupportedMethod         ClickHouseErrorCode = 1
	CHUnsupportedParameter      ClickHouseErrorCode = 2
	CHCannotParseInputAssertion ClickHouseErrorCode = 117
	CHSyntaxError               ClickHouseErrorCode = 62
	CHUnknownIdentifier         ClickHouseErrorCode = 47
	CHUnknownTable              ClickHouseErrorCode = 60
	CHUnknownDatabase           ClickHouseErrorCode = 81
	CHUnknownColumn             ClickHouseErrorCode = 8
	CHUnknownSetting            ClickHouseErrorCode = 115
	CHNotFound                  ClickHouseErrorCode = 35
	CHMissingColumns            ClickHouseErrorCode = 36
	CHTooManyRows               ClickHouseErrorCode = 158
	CHMemoryLimit               ClickHouseErrorCode = 241
	CHTimeout                   ClickHouseErrorCode = 159
	CHQuotaExceeded             ClickHouseErrorCode = 130
	CHAttemptToReadAfterEOF     ClickHouseErrorCode = 32
	CHCannotDecompress          ClickHouseErrorCode = 34
	CHAbortedByClient           ClickHouseErrorCode = 236
	CHNoFreeConnection          ClickHouseErrorCode = 192
	CHAuthFailed                ClickHouseErrorCode = 516
	CHUnknownAggregateFunction  ClickHouseErrorCode = 63
	CHUnknownFormat             ClickHouseErrorCode = 73
	CHBadArguments              ClickHouseErrorCode = 36
	CHCannotCompileQuery        ClickHouseErrorCode = 81
)

// CHError carries a parsed ClickHouse exception code alongside the
// original error message. It implements the error interface so it
// flows transparently through `fmt.Errorf("...: %w", err)` chains.
type CHError struct {
	Code    ClickHouseErrorCode
	Message string
	Cause   error // optional, for unwrapping
}

func (e *CHError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code == CHUnknown {
		return e.Message
	}
	return fmt.Sprintf("Code: %d. DB::Exception: %s", int32(e.Code), e.Message)
}

func (e *CHError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// IsRetryable returns true if the underlying condition is transient and
// the operation might succeed on retry (e.g. timeouts, quota limits,
// connection failures). It returns false for permanent errors like
// syntax errors, unknown tables, or auth failures.
func (e *CHError) IsRetryable() bool {
	if e == nil {
		return false
	}
	switch e.Code {
	case CHTimeout,
		CHMemoryLimit,
		CHQuotaExceeded,
		CHAttemptToReadAfterEOF,
		CHCannotDecompress,
		CHAbortedByClient,
		CHNoFreeConnection:
		return true
	}
	return false
}

// Classify inspects an error returned from any clickhouse client call
// (HTTP or native transport) and returns:
//
//   - The parsed CHError (with code=CHUnknown if unrecognised).
//   - A boolean indicating whether the error is a sentinel ErrNotFound.
//
// If the error is not a ClickHouse error at all (e.g. a network failure),
// Classify returns nil — the caller should treat it as a generic
// connection/transport failure.
func Classify(err error) (*CHError, bool) {
	if err == nil {
		return nil, false
	}

	// Already-classified CHError: pass through.
	var chErr *CHError
	if errors.As(err, &chErr) {
		return chErr, errors.Is(err, ErrNotFound)
	}

	// Library-level exception: extract code from native driver.
	var chExc *ch.Exception
	if errors.As(err, &chExc) {
		return &CHError{
			Code:    ClickHouseErrorCode(chExc.Code),
			Message: chExc.Message,
			Cause:   err,
		}, false
	}

	// HTTP path: "clickhouse error: Code: 60. DB::Exception: ..."
	// (from execute.go:68). Best-effort regex parse.
	if parsed := parseHTTPError(err); parsed != nil {
		return parsed, false
	}

	// Sentinel "not found" — used by clickhouse client code to flag
	// absent rows (e.g. thread_profile.go:77) or by the driver itself
	// when QueryRow returns no rows.
	if errors.Is(err, ErrNotFound) || errors.Is(err, sql.ErrNoRows) {
		return &CHError{
			Code:    CHNotFound,
			Message: err.Error(),
			Cause:   err,
		}, true
	}

	// Not a CH error (network failure, context cancellation, etc.).
	return nil, errors.Is(err, ErrNotFound)
}

// httpErrorPattern matches the body of a ClickHouse HTTP error response:
//
//	"Code: 60. DB::Exception: No rows in table..."
//	"Code: 47. DB::Exception: Unknown identifier..."
var httpErrorPattern = regexp.MustCompile(`Code:\s*(\d+)`)

func parseHTTPError(err error) *CHError {
	msg := err.Error()
	idx := strings.Index(msg, "Code:")
	if idx < 0 {
		return nil
	}
	m := httpErrorPattern.FindStringSubmatch(msg[idx:])
	if m == nil {
		return nil
	}
	code, perr := strconv.ParseInt(m[1], 10, 32)
	if perr != nil {
		return nil
	}
	// Strip the leading "clickhouse error: " wrapper if present so
	// callers see a tidy message.
	body := msg
	if after, ok := strings.CutPrefix(msg, "clickhouse error: "); ok {
		body = after
	}
	return &CHError{
		Code:    ClickHouseErrorCode(code),
		Message: body,
		Cause:   err,
	}
}

// NotFoundErrorf wraps a "not found" sentinel into a formatted error so
// callers can use errors.Is(err, ErrNotFound) without losing context.
func NotFoundErrorf(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrNotFound}, args...)...)
}
