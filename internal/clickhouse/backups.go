package clickhouse

import (
	"context"
	"fmt"
)

// BackupEntry is one row of system.backups: a BACKUP/RESTORE statement,
// running or finished. The ops story for ClickHouse backups is otherwise
// "run the statement, then query system.backps by hand" — this surfaces
// status, progress, and failures without that.
type BackupEntry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time,omitempty"`
	// Size and progress: total_size is the backup's expected size;
	// files_read/bytes_read track progress while status = 'CREATING'.
	// (system.backups has no per-restore write counters on current servers —
	// restore progress falls back to num_files/total_size in the UI.)
	NumFiles  uint64 `json:"num_files"`
	TotalSize uint64 `json:"total_size"`
	FilesRead uint64 `json:"files_read"`
	BytesRead uint64 `json:"bytes_read"`
}

// ListBackups returns recent backup/restore activity, newest first. Some
// columns (bytes_read et al.) were added after the initial system.backups
// table; on older servers the rich query fails and we degrade to the base
// shape rather than failing the whole page (same pattern as GetColumns).
func (c *Client) ListBackups(ctx context.Context, limit int) ([]BackupEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	rich := func() ([]BackupEntry, error) {
		q := fmt.Sprintf(`
			SELECT id, name, status, COALESCE(error, ''), toString(start_time),
			       COALESCE(toString(end_time), ''),
			       COALESCE(num_files, 0), COALESCE(total_size, 0),
			       COALESCE(files_read, 0), COALESCE(bytes_read, 0)
			FROM %s
			ORDER BY start_time DESC
			LIMIT %d`, c.tableRef("backups"), limit)
		rows, err := c.conn.Query(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		var out []BackupEntry
		for rows.Next() {
			var b BackupEntry
			if err := rows.Scan(&b.ID, &b.Name, &b.Status, &b.Error, &b.StartTime,
				&b.EndTime, &b.NumFiles, &b.TotalSize,
				&b.FilesRead, &b.BytesRead); err != nil {
				return nil, err
			}
			out = append(out, b)
		}
		return out, rows.Err()
	}

	base := func() ([]BackupEntry, error) {
		q := fmt.Sprintf(`
			SELECT id, name, status, COALESCE(error, ''), toString(start_time),
			       COALESCE(toString(end_time), '')
			FROM %s
			ORDER BY start_time DESC
			LIMIT %d`, c.tableRef("backups"), limit)
		rows, err := c.conn.Query(ctx, q)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		var out []BackupEntry
		for rows.Next() {
			var b BackupEntry
			if err := rows.Scan(&b.ID, &b.Name, &b.Status, &b.Error, &b.StartTime, &b.EndTime); err != nil {
				return nil, err
			}
			out = append(out, b)
		}
		return out, rows.Err()
	}

	entries, err := rich()
	if err != nil {
		// Older server without the progress columns — try the base shape.
		entries, err = base()
		if err != nil {
			return nil, fmt.Errorf("querying system.backups: %w", err)
		}
	}
	if entries == nil {
		entries = []BackupEntry{}
	}
	return entries, nil
}
