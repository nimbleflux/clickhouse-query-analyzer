package clickhouse

import (
	"context"
	"fmt"
)

// MutationDetail is one row of system.mutations (is_done = 0). Unlike the
// Replication page's lightweight MutationEntry, this carries the fields needed
// to manage mutations: age, kill state, and failure detail. system.mutations
// exposes no "done"/"total" part counts, so progress is reported as the
// remaining parts_to_do (trending to 0), not a synthetic percentage.
type MutationDetail struct {
	Database            string `json:"database"`
	Table               string `json:"table"`
	MutationID          string `json:"mutation_id"`
	Command             string `json:"command"`
	CreateTime          string `json:"create_time"`
	AgeSeconds          uint64 `json:"age_seconds"`
	PartsToDo           int64  `json:"parts_to_do"`
	IsDone              uint8  `json:"is_done"`
	IsKilled            uint8  `json:"is_killed"`
	LatestFailedPart    string `json:"latest_failed_part"`
	LatestFailTime      string `json:"latest_fail_time"`
	LatestFailReason    string `json:"latest_fail_reason"`
	LatestFailErrorCode string `json:"latest_fail_error_code_name"`
}

// ListMutations returns active (not-yet-done) mutations across the cluster.
// Killed-but-not-cleaned-up mutations are included so operators can see them
// finishing; is_killed distinguishes them.
func (c *Client) ListMutations(ctx context.Context) ([]MutationDetail, error) {
	table := c.tableRef("mutations")
	query := fmt.Sprintf(`SELECT
		database, table, mutation_id, command,
		toString(create_time),
		toUInt64(dateDiff('second', create_time, now())) AS age_seconds,
		parts_to_do, is_done, is_killed,
		latest_failed_part, toString(latest_fail_time), latest_fail_reason, latest_fail_error_code_name
	FROM %s
	WHERE is_done = 0
	ORDER BY create_time DESC
	LIMIT 500`, table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("querying mutations: %w", err)
	}
	defer rows.Close()

	var out []MutationDetail
	for rows.Next() {
		var m MutationDetail
		if err := rows.Scan(
			&m.Database, &m.Table, &m.MutationID, &m.Command,
			&m.CreateTime, &m.AgeSeconds,
			&m.PartsToDo, &m.IsDone, &m.IsKilled,
			&m.LatestFailedPart, &m.LatestFailTime, &m.LatestFailReason, &m.LatestFailErrorCode,
		); err != nil {
			return nil, fmt.Errorf("scanning mutation row: %w", err)
		}
		out = append(out, m)
	}
	if out == nil {
		out = []MutationDetail{}
	}
	return out, nil
}

// KillMutation cancels a mutation. A killed mutation stops being assigned new
// parts; parts already in progress finish. The row stays in system.mutations
// (is_killed = 1) until fully cleaned up.
func (c *Client) KillMutation(ctx context.Context, database, table, mutationID string) error {
	return c.conn.Exec(ctx,
		"KILL MUTATION WHERE database = ? AND table = ? AND mutation_id = ?",
		database, table, mutationID)
}
