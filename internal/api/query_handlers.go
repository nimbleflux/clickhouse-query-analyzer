package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// defaultQueryLogWindow enforces a sane from_time when the caller omits one, so
// query_log scans hit partition pruning instead of walking the full TTL.
// On a busy server an unbounded window means aggregating the entire retention
// (often 7-30 days, billions of rows) on every page load. The clamp defaults
// to the last 24h; callers that genuinely want all-time pass no_clamp=1.
// Returns the effective from_time and whether it was synthesized.
func defaultQueryLogWindow(r *http.Request) (string, bool) {
	if v := r.URL.Query().Get("from_time"); v != "" {
		return v, false
	}
	if v := r.URL.Query().Get("no_clamp"); v == "1" || v == "true" {
		return "", false
	}
	return time.Now().Add(-24 * time.Hour).Format("2006-01-02 15:04:05"), true
}

func (a *API) GetQueryHealthTrend(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	hours, _ := strconv.Atoi(r.URL.Query().Get("hours"))
	points, err := ch.GetQueryHealthTrend(r.Context(), hours)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, points)
}

func (a *API) ListQueries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	params := clickhouse.QueryListParams{
		ToTime:            r.URL.Query().Get("to_time"),
		User:              r.URL.Query().Get("user"),
		Database:          r.URL.Query().Get("database"),
		Table:             r.URL.Query().Get("table"),
		QueryKind:         r.URL.Query().Get("query_kind"),
		Search:            r.URL.Query().Get("search"),
		SortBy:            r.URL.Query().Get("sort_by"),
		SortDir:           strings.ToUpper(r.URL.Query().Get("sort_dir")),
		HideSystemQueries: r.URL.Query().Get("hide_system_queries") != "false",
		IncludeCount:      r.URL.Query().Get("include_count") != "false",
		ErrorsOnly:        r.URL.Query().Get("errors_only") == "true",
		LogComment:        r.URL.Query().Get("log_comment"),
	}
	params.FromTime, _ = defaultQueryLogWindow(r)

	if v := r.URL.Query().Get("min_duration"); v != "" {
		params.MinDuration, _ = strconv.ParseUint(v, 10, 64)
	}
	if v := r.URL.Query().Get("min_memory"); v != "" {
		params.MinMemory, _ = strconv.ParseUint(v, 10, 64)
	}
	if v := r.URL.Query().Get("min_read_bytes"); v != "" {
		params.MinReadBytes, _ = strconv.ParseUint(v, 10, 64)
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		params.Limit, _ = strconv.Atoi(v)
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		params.Offset, _ = strconv.Atoi(v)
	}

	queries, total, err := ch.ListQueries(r.Context(), params)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if queries == nil {
		queries = []clickhouse.QueryLogEntry{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"queries": queries,
		"total":   total,
		"limit":   params.Limit,
		"offset":  params.Offset,
	})
}

func (a *API) GetQuery(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	query, err := ch.GetQuery(r.Context(), queryID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, query)
}

func (a *API) GetQueryMetrics(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	metrics, err := ch.GetQueryMetrics(r.Context(), queryID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, metrics)
}

func (a *API) GetQueryThreads(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	threads, err := ch.GetQueryThreads(r.Context(), queryID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, threads)
}

func (a *API) GetThreadSummaries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	summaries, err := ch.GetThreadSummaries(r.Context(), queryID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, summaries)
}

func (a *API) GetThreadProfile(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	threadIDStr := chi.URLParam(r, "threadID")
	if threadIDStr == "" {
		MissingParam(w, "thread_id")
		return
	}

	var threadID uint64
	if _, err := fmt.Sscanf(threadIDStr, "%d", &threadID); err != nil {
		InvalidParam(w, "thread_id", "thread_id must be a non-negative integer")
		return
	}

	profile, err := ch.GetThreadProfile(r.Context(), queryID, threadID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, profile)
}

func (a *API) GetTrace(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	traceType := r.URL.Query().Get("type")
	traces, err := ch.GetTraceLog(r.Context(), queryID, traceType)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, traces)
}

func (a *API) GetFlameGraph(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	traceType := r.URL.Query().Get("type")
	if traceType == "" {
		traceType = "MemorySample"
	}

	data, err := ch.GetFlameGraph(r.Context(), queryID, traceType)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, data)
}

func (a *API) GetQueryViews(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	views, err := ch.GetQueryViews(r.Context(), queryID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, views)
}

func (a *API) GetExplain(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	query, err := ch.GetQuery(r.Context(), queryID)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	result, err := ch.GetExplain(r.Context(), query.Query)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (a *API) CompareQueries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	idA := r.URL.Query().Get("a")
	idB := r.URL.Query().Get("b")
	if idA == "" || idB == "" {
		MissingParam(w, "query ids 'a' and 'b'")
		return
	}

	qA, err := ch.GetQuery(r.Context(), idA)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	qB, err := ch.GetQuery(r.Context(), idB)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"a": qA,
		"b": qB,
	})
}

func (a *API) ExecuteQuery(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	var req struct {
		Query    string            `json:"query"`
		Limit    int               `json:"limit"`
		Offset   int               `json:"offset"`
		MaxRows  int               `json:"max_rows"`
		Settings map[string]string `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		InvalidBody(w, "")
		return
	}
	if req.Query == "" {
		MissingParam(w, "query")
		return
	}
	if isReadonly(r) && rejectWriteQuery(w, req.Query) {
		return
	}

	// Prefer the explicit limit/offset window (server-side pagination).
	// Fall back to max_rows for backwards compatibility with older clients.
	limit, offset := req.Limit, req.Offset
	if limit <= 0 {
		limit = req.MaxRows
	}
	if limit <= 0 {
		limit = 1000
	}
	if limit > 1000 {
		limit = 1000
	}
	if offset < 0 {
		offset = 0
	}

	result, err := ch.ExecuteQuery(r.Context(), req.Query, limit, offset, req.Settings)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (a *API) GetSchema(w http.ResponseWriter, r *http.Request) {
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
	if databases == nil {
		databases = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"databases": databases})
}

func (a *API) GetTables(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	db := chi.URLParam(r, "db")
	tables, err := ch.GetTables(r.Context(), db)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if tables == nil {
		tables = []clickhouse.TableInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tables": tables})
}

func (a *API) GetColumns(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	db := chi.URLParam(r, "db")
	tbl := chi.URLParam(r, "table")
	columns, err := ch.GetColumns(r.Context(), db, tbl)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if columns == nil {
		columns = []clickhouse.ColumnInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"columns": columns})
}

func (a *API) ListProcesses(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	processes, err := ch.ListProcesses(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, processes)
}

func (a *API) KillProcess(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		MissingParam(w, "query_id")
		return
	}

	if err := ch.KillQuery(r.Context(), queryID); err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) KillProcessesByUser(w http.ResponseWriter, r *http.Request) {
	user := r.URL.Query().Get("user")
	if user == "" {
		MissingParam(w, "user")
		return
	}

	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	killed, err := ch.KillQueriesByUser(r.Context(), user)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"killed": killed,
		"user":   user,
	})
}

func (a *API) ListFingerprints(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	params := clickhouse.QueryListParams{
		ToTime:            r.URL.Query().Get("to_time"),
		User:              r.URL.Query().Get("user"),
		Search:            r.URL.Query().Get("search"),
		SortBy:            r.URL.Query().Get("sort_by"),
		SortDir:           strings.ToUpper(r.URL.Query().Get("sort_dir")),
		HideSystemQueries: r.URL.Query().Get("hide_system_queries") != "false",
		IncludeCount:      r.URL.Query().Get("include_count") != "false",
		LogComment:        r.URL.Query().Get("log_comment"),
	}
	params.FromTime, _ = defaultQueryLogWindow(r)

	if v := r.URL.Query().Get("limit"); v != "" {
		params.Limit, _ = strconv.Atoi(v)
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		params.Offset, _ = strconv.Atoi(v)
	}

	fingerprints, total, err := ch.ListFingerprints(r.Context(), params)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if fingerprints == nil {
		fingerprints = []clickhouse.QueryFingerprint{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"fingerprints": fingerprints,
		"total":        total,
		"limit":        params.Limit,
		"offset":       params.Offset,
	})
}

func (a *API) GetFingerprintTrend(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	hashStr := chi.URLParam(r, "hash")
	if hashStr == "" {
		MissingParam(w, "hash")
		return
	}
	hash, err := strconv.ParseUint(hashStr, 10, 64)
	if err != nil {
		InvalidParam(w, "hash", "")
		return
	}

	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "hour"
	}

	points, err := ch.GetFingerprintTrend(r.Context(), hash, interval, r.URL.Query().Get("from_time"), r.URL.Query().Get("to_time"))
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, points)
}

func (a *API) ListFingerprintQueries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	hashStr := chi.URLParam(r, "hash")
	if hashStr == "" {
		MissingParam(w, "hash")
		return
	}
	hash, err := strconv.ParseUint(hashStr, 10, 64)
	if err != nil {
		InvalidParam(w, "hash", "")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	queries, total, err := ch.ListFingerprintQueries(r.Context(), hash, limit, offset)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"queries": queries,
		"total":   total,
	})
}

func (a *API) GetDashboard(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	dashboard, err := ch.GetDashboard(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, dashboard)
}

func (a *API) ListMutations(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	mutations, err := ch.ListMutations(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, mutations)
}

func (a *API) KillMutationHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Database   string `json:"database"`
		Table      string `json:"table"`
		MutationID string `json:"mutation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		InvalidBody(w, "")
		return
	}
	if req.Database == "" || req.Table == "" || req.MutationID == "" {
		MissingParam(w, "database, table, mutation_id")
		return
	}

	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	if err := ch.KillMutation(r.Context(), req.Database, req.Table, req.MutationID); err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) ListMerges(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	merges, err := ch.ListMerges(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, merges)
}

func (a *API) GetAccess(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	access, err := ch.GetAccess(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, access)
}

func (a *API) DropUser(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "user")
	if name == "" {
		MissingParam(w, "user")
		return
	}
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	if err := ch.DropUser(r.Context(), name); err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) DropRole(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "role")
	if name == "" {
		MissingParam(w, "role")
		return
	}
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	if err := ch.DropRole(r.Context(), name); err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) RevokeGrant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GranteeKind string `json:"grantee_kind"` // "user" | "role"
		Grantee     string `json:"grantee"`
		AccessType  string `json:"access_type"`
		Database    string `json:"database"`
		Table       string `json:"table"`
		Column      string `json:"column"`
		GrantOption bool   `json:"grant_option"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		InvalidBody(w, "")
		return
	}
	if req.Grantee == "" || req.AccessType == "" {
		MissingParam(w, "grantee, access_type")
		return
	}
	if req.GranteeKind == "" {
		req.GranteeKind = "user"
	}
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	if err := ch.RevokeGrant(r.Context(), req.GranteeKind, req.Grantee, req.AccessType, req.Database, req.Table, req.Column, req.GrantOption); err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) GetTableDDL(w http.ResponseWriter, r *http.Request) {
	db := chi.URLParam(r, "db")
	table := chi.URLParam(r, "table")
	if db == "" || table == "" {
		MissingParam(w, "db, table")
		return
	}
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	stmt, err := ch.GetTableDDL(r.Context(), db, table)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"statement": stmt})
}

func (a *API) GetRoleGrants(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "role")
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	stmt, err := ch.ShowGrantsFor(r.Context(), name)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"statement": stmt})
}

func (a *API) GetUserGrants(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "user")
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	stmt, err := ch.ShowGrantsFor(r.Context(), name)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"statement": stmt})
}

func (a *API) ListAsyncMetrics(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	metrics, err := ch.ListAsyncMetrics(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, metrics)
}
