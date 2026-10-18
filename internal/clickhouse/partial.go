package clickhouse

import "sync"

// PartialErrors records best-effort sections that failed while assembling a
// response (dashboard, replication, DDL, access). Embedded in the response
// types — the promoted fields keep the wire shape the frontend already
// expects: `partial_errors` is the clean list of system-table names for the
// banner, `partial_error_details` maps each name to the raw error for the
// details view. This replaces four byte-identical per-type addPartial
// methods.
type PartialErrors struct {
	// mu guards the two fields: the dashboard runs its section queries
	// concurrently and several of them call addPartial on the shared
	// response. The struct must not be copied while in use (all callers
	// hold it behind a pointer).
	mu                  sync.Mutex
	PartialErrors       []string          `json:"partial_errors"`
	PartialErrorDetails map[string]string `json:"partial_error_details,omitempty"`
}

// addPartial records a partial failure for one of the system.* tables a
// response aggregates. The banner no longer assumes the cause is access
// rights — the real error (permission denied, missing column, version skew,
// a query bug) is surfaced. Safe to call with a nil error (no-op).
func (p *PartialErrors) addPartial(table string, err error) {
	if err == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.PartialErrorDetails == nil {
		p.PartialErrorDetails = map[string]string{}
	}
	if _, ok := p.PartialErrorDetails[table]; !ok {
		p.PartialErrors = append(p.PartialErrors, table)
	}
	p.PartialErrorDetails[table] = err.Error()
}

// initPartialErrors normalizes the list to an empty slice so JSON renders []
// instead of null for handlers that don't pre-initialize.
func (p *PartialErrors) initPartialErrors() {
	if p.PartialErrors == nil {
		p.PartialErrors = []string{}
	}
}
