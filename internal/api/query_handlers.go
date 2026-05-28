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

func (a *API) Connect(w http.ResponseWriter, r *http.Request) {
	_, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) ListQueries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	params := clickhouse.QueryListParams{
		FromTime:  r.URL.Query().Get("from_time"),
		ToTime:    r.URL.Query().Get("to_time"),
		User:      r.URL.Query().Get("user"),
		QueryKind: r.URL.Query().Get("query_kind"),
		Search:    r.URL.Query().Get("search"),
		SortBy:    r.URL.Query().Get("sort_by"),
		SortDir:   strings.ToUpper(r.URL.Query().Get("sort_dir")),
	}

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
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	query, err := ch.GetQuery(r.Context(), queryID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "query not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, query)
}

func (a *API) GetQueryMetrics(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	metrics, err := ch.GetQueryMetrics(r.Context(), queryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, metrics)
}

func (a *API) GetQueryThreads(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	threads, err := ch.GetQueryThreads(r.Context(), queryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, threads)
}

func (a *API) GetThreadSummaries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	summaries, err := ch.GetThreadSummaries(r.Context(), queryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, summaries)
}

func (a *API) GetThreadProfile(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	threadIDStr := chi.URLParam(r, "threadID")
	if threadIDStr == "" {
		writeError(w, http.StatusBadRequest, "thread_id is required")
		return
	}

	var threadID uint64
	if _, err := fmt.Sscanf(threadIDStr, "%d", &threadID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid thread_id")
		return
	}

	profile, err := ch.GetThreadProfile(r.Context(), queryID, threadID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, profile)
}

func (a *API) GetTrace(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	traceType := r.URL.Query().Get("type")
	traces, err := ch.GetTraceLog(r.Context(), queryID, traceType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, traces)
}

func (a *API) GetFlameGraph(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	traceType := r.URL.Query().Get("type")
	if traceType == "" {
		traceType = "MemorySample"
	}

	data, err := ch.GetFlameGraph(r.Context(), queryID, traceType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, data)
}

func (a *API) GetQueryViews(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	views, err := ch.GetQueryViews(r.Context(), queryID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, views)
}

func (a *API) GetExplain(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	query, err := ch.GetQuery(r.Context(), queryID)
	if err != nil {
		writeError(w, http.StatusNotFound, "query not found")
		return
	}

	result, err := ch.GetExplain(r.Context(), query.Query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (a *API) CompareQueries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	idA := r.URL.Query().Get("a")
	idB := r.URL.Query().Get("b")
	if idA == "" || idB == "" {
		writeError(w, http.StatusBadRequest, "query ids 'a' and 'b' are required")
		return
	}

	qA, err := ch.GetQuery(r.Context(), idA)
	if err != nil {
		writeError(w, http.StatusNotFound, "query A not found")
		return
	}

	qB, err := ch.GetQuery(r.Context(), idB)
	if err != nil {
		writeError(w, http.StatusNotFound, "query B not found")
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	var req struct {
		Query    string            `json:"query"`
		MaxRows  int               `json:"max_rows"`
		Settings map[string]string `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}
	if req.MaxRows <= 0 {
		req.MaxRows = 1000
	}

	result, err := ch.ExecuteQuery(r.Context(), req.Query, req.MaxRows, req.Settings)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (a *API) GetSchema(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	databases, err := ch.GetDatabases(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	db := chi.URLParam(r, "db")
	tables, err := ch.GetTables(r.Context(), db)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	db := chi.URLParam(r, "db")
	tbl := chi.URLParam(r, "table")
	columns, err := ch.GetColumns(r.Context(), db, tbl)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	processes, err := ch.ListProcesses(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, processes)
}

func (a *API) KillProcess(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	queryID := chi.URLParam(r, "queryID")
	if queryID == "" {
		writeError(w, http.StatusBadRequest, "query_id is required")
		return
	}

	if err := ch.KillQuery(r.Context(), queryID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) ListFingerprints(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	params := clickhouse.QueryListParams{
		FromTime: r.URL.Query().Get("from_time"),
		ToTime:   r.URL.Query().Get("to_time"),
		User:     r.URL.Query().Get("user"),
		Search:   r.URL.Query().Get("search"),
		SortBy:   r.URL.Query().Get("sort_by"),
		SortDir:  strings.ToUpper(r.URL.Query().Get("sort_dir")),
	}

	if v := r.URL.Query().Get("limit"); v != "" {
		params.Limit, _ = strconv.Atoi(v)
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		params.Offset, _ = strconv.Atoi(v)
	}

	fingerprints, total, err := ch.ListFingerprints(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	hashStr := chi.URLParam(r, "hash")
	if hashStr == "" {
		writeError(w, http.StatusBadRequest, "hash is required")
		return
	}
	hash, err := strconv.ParseUint(hashStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	interval := r.URL.Query().Get("interval")
	if interval == "" {
		interval = "hour"
	}

	points, err := ch.GetFingerprintTrend(r.Context(), hash, interval, r.URL.Query().Get("from_time"), r.URL.Query().Get("to_time"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, points)
}

func (a *API) ListFingerprintQueries(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	hashStr := chi.URLParam(r, "hash")
	if hashStr == "" {
		writeError(w, http.StatusBadRequest, "hash is required")
		return
	}
	hash, err := strconv.ParseUint(hashStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid hash")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	queries, total, err := ch.ListFingerprintQueries(r.Context(), hash, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	dashboard, err := ch.GetDashboard(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, dashboard)
}
