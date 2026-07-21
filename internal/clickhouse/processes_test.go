package clickhouse

import (
	"strings"
	"testing"
)

// TestProcessColumns_ReadsLogCommentFromSettings is a belt-and-suspenders
// check that the system.processes SELECT surfaces log_comment so the frontend
// can identify ClickLens's own queries (the sole signal for "internal").
//
// system.processes has no native log_comment column, so the SELECT must read
// it from the Settings map: `Settings['log_comment'] AS log_comment`.
// Asserting both halves catches the regression that triggered PR #29 — the
// original PR #28 queried `log_comment` directly and ClickHouse rejected it
// with UNKNOWN_IDENTIFIER.
func TestProcessColumns_ReadsLogCommentFromSettings(t *testing.T) {
	if !strings.Contains(processColumns, "Settings['log_comment']") {
		t.Errorf("processColumns = %q, expected to read Settings['log_comment']", processColumns)
	}
	if strings.Contains(processColumns, "current_database,\n\tlog_comment,") {
		t.Errorf("processColumns must not select log_comment as a bare column — system.processes has no such column")
	}
}

// TestProcessEntry_ScanTargets_LogComment makes sure the LogComment field is
// wired into scanTargets — otherwise the column would come back from
// system.processes but never populate the struct, and the frontend filter
// would never see "clicklens".
func TestProcessEntry_ScanTargets_LogComment(t *testing.T) {
	p := &ProcessEntry{}
	targets := p.scanTargets()

	logCommentValue := "clicklens"
	for _, t := range targets {
		if strPtr, ok := t.(*string); ok {
			*strPtr = logCommentValue
			if p.LogComment == logCommentValue {
				return
			}
			*strPtr = ""
		}
	}
	t.Errorf("scanTargets() = %d entries, none pointed at &p.LogComment", len(targets))
}
