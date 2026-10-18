package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func (a *API) ConnectWithInfo(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, true, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":       "ok",
		"cluster":      ch.Cluster(),
		"is_cluster":   ch.IsCluster(),
		"cluster_note": ch.ClusterNote(),
		// Server timezone: the query-history pages render raw
		// server-wall-clock strings; the UI needs the zone name to offer
		// "show times in browser timezone" conversion. Empty = detection
		// failed (restricted user, broken server) and times show as stored.
		"timezone": ch.ServerTimezone(r.Context()),
	})
}

// GetConfig returns server-side default connection settings so the frontend
// can pre-fill the connection form. The password is never exposed — only a
// boolean indicating whether one is configured server-side. Operators can
// hide the URL/user entirely with -hide-default-connection.
func (a *API) GetConfig(w http.ResponseWriter, r *http.Request) {
	if a.defaultURL == "" || a.hideDefaultConnection {
		writeJSON(w, http.StatusOK, map[string]interface{}{})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"default_connection": map[string]interface{}{
			"url":          a.defaultURL,
			"user":         a.defaultUser,
			"database":     a.defaultDatabase,
			"has_password": a.defaultPassword != "",
			"skip_tls":     false,
		},
	})
}

// ListBackups serves the Backups page: recent BACKUP/RESTORE activity from
// system.backups with status, size and progress.
func (a *API) ListBackups(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	backups, err := ch.ListBackups(r.Context(), limit)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if backups == nil {
		backups = []clickhouse.BackupEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"backups": backups})
}

// ListTableParts serves the per-table parts explorer.
func (a *API) ListTableParts(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	db := chi.URLParam(r, "db")
	table := chi.URLParam(r, "table")
	if db == "" || table == "" {
		MissingParam(w, "db, table")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	parts, summary, err := ch.ListTableParts(r.Context(), db, table, limit)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if parts == nil {
		parts = []clickhouse.PartDetail{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"parts":   parts,
		"summary": summary,
		// The part list is capped while the summary aggregates ALL parts —
		// tell the UI so it can say "showing N of M parts".
		"limit":       limit,
		"total_parts": summary.Parts,
	})
}
