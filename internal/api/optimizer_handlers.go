package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func writeSSE(w http.ResponseWriter, flusher http.Flusher, evt clickhouse.BulkEvent) {
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	if flusher != nil {
		flusher.Flush()
	}
}

// beginSSE writes the SSE response head and flushes immediately. The
// X-Accel-Buffering header mirrors the /api/execute NDJSON path: without it
// nginx buffers the stream and "real-time" table analysis appears to hang
// until completion.
func beginSSE(w http.ResponseWriter) http.Flusher {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if f, ok := w.(http.Flusher); ok {
		// Leading bytes through the proxy before the first table analysis.
		fmt.Fprint(w, ": stream open\n\n")
		f.Flush()
		return f
	}
	return nil
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

	// Skipping-index suggestions get measured, not just guessed: a
	// session-scoped hypothetical index + EXPLAIN WHATIF reports the
	// projected skip ratio / marks (ClickHouse ≥ 26.6). Best-effort —
	// failures leave the heuristic recommendation untouched.
	if r.URL.Query().Get("validate") != "0" && analysis != nil {
		for i := range analysis.Recommendations {
			rec := &analysis.Recommendations[i]
			if rec.Category != "index" || rec.RequiresRecreate {
				continue
			}
			indexType, column, ok := parseSuggestedIndex(rec.Suggested)
			if !ok {
				continue
			}
			rec.Validation = ch.ValidateIndexSuggestion(r.Context(), database, table, column, indexType, 4, clickhouse.SampleForColumn(analysis, column))
		}
	}

	writeJSON(w, http.StatusOK, analysis)
}

// parseSuggestedIndex reads `minmax(`col`)` / `bloom_filter(`col`)` shaped
// suggestions produced by the index recommender.
func parseSuggestedIndex(suggested string) (indexType, column string, ok bool) {
	open := strings.Index(suggested, "(")
	if open <= 0 || !strings.HasSuffix(suggested, ")") {
		return "", "", false
	}
	indexType = strings.ToLower(strings.TrimSpace(suggested[:open]))
	column = strings.TrimSpace(suggested[open+1 : len(suggested)-1])
	column = strings.Trim(column, "`")
	if indexType == "" || column == "" || strings.ContainsAny(column, "(),") {
		return "", "", false
	}
	switch indexType {
	case "minmax", "bloom_filter", "set", "ngrambf_v1", "tokenbf_v1":
		return indexType, column, true
	}
	return "", "", false
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

	flusher := beginSSE(w)

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

	flusher := beginSSE(w)

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
