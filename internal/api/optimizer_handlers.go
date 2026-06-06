package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func writeSSE(w http.ResponseWriter, flusher http.Flusher, evt clickhouse.BulkEvent) {
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

func (a *API) AnalyzeTableHandler(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	database := chi.URLParam(r, "db")
	table := chi.URLParam(r, "table")
	if database == "" || table == "" {
		MissingParam(w, "database and table")
		return
	}

	analysis, err := ch.AnalyzeTable(r.Context(), database, table)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, analysis)
}

func (a *API) AnalyzeDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	database := chi.URLParam(r, "db")
	if database == "" {
		MissingParam(w, "database")
		return
	}

	filters := parseBulkFilters(r)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, _ := w.(http.Flusher)

	ch.StreamBulkAnalysis(r.Context(), database, filters, func(evt clickhouse.BulkEvent) {
		writeSSE(w, flusher, evt)
	})
}

func (a *API) AnalyzeAllHandler(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	databases, err := ch.GetDatabases(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}

	filters := parseBulkFilters(r)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, _ := w.(http.Flusher)

	for _, database := range databases {
		if filters.ExcludeSystem && isSystemDatabase(database) {
			continue
		}

		select {
		case <-r.Context().Done():
			return
		default:
		}

		ch.StreamBulkAnalysis(r.Context(), database, filters, func(evt clickhouse.BulkEvent) {
			writeSSE(w, flusher, evt)
		})
	}
}

func parseBulkFilters(r *http.Request) clickhouse.BulkFilters {
	f := clickhouse.BulkFilters{
		ExcludeSystem: true,
	}
	if v := r.URL.Query().Get("engine"); v != "" {
		f.Engine = v
	}
	if v := r.URL.Query().Get("min_rows"); v != "" {
		f.MinRows, _ = strconv.ParseUint(v, 10, 64)
	}
	if v := r.URL.Query().Get("min_bytes"); v != "" {
		f.MinBytes, _ = strconv.ParseUint(v, 10, 64)
	}
	if v := r.URL.Query().Get("exclude_system"); v == "false" {
		f.ExcludeSystem = false
	}
	return f
}

func isSystemDatabase(db string) bool {
	switch db {
	case "system", "INFORMATION_SCHEMA", "information_schema",
		"_system",
		"tmp", "temp":
		return true
	}
	return false
}
