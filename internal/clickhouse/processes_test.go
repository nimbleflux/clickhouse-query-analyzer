package clickhouse

import (
	"strings"
	"testing"
)

// TestProcessColumns_HasLogComment is a belt-and-suspenders check that
// system.processes SELECTs surface log_comment so the frontend can identify
// ClickLens's own queries (the sole signal for "internal").
func TestProcessColumns_HasLogComment(t *testing.T) {
	if !strings.Contains(processColumns, "log_comment") {
		t.Errorf("processColumns = %q, expected to include log_comment", processColumns)
	}
}

// TestProcessEntry_ScanTargets_LogComment makes sure the new LogComment field
// is wired into scanTargets — otherwise the column would come back from
// system.processes but never populate the struct, and the frontend filter
// would never see "clicklens".
func TestProcessEntry_ScanTargets_LogComment(t *testing.T) {
	p := &ProcessEntry{}
	targets := p.scanTargets()

	// scanTargets returns a pointer per selected column. Mutate the field
	// through the slice and confirm LogComment reflects it — that only
	// works if the right pointer is in the slice.
	logCommentValue := "clicklens"
	for i, t := range targets {
		if strPtr, ok := t.(*string); ok {
			*strPtr = logCommentValue
			if p.LogComment == logCommentValue {
				return
			}
			// reset in case we picked the wrong *string on the way
			*strPtr = ""
		}
		_ = i
	}
	t.Errorf("scanTargets() = %d entries, none pointed at &p.LogComment", len(targets))
}
