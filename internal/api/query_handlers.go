package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

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

// sanitizeLogComment vets the editor's optional query tag before it becomes
// the log_comment setting: single line, control-char free, bounded length.
func sanitizeLogComment(tag string) string {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range tag {
		if r == '\n' || r == '\r' || unicode.IsControl(r) {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
		if b.Len() >= 256 {
			break
		}
	}
	return strings.TrimSpace(b.String())
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
		"queries":                queries,
		"total":                  total,
		"limit":                  params.Limit,
		"offset":                 params.Offset,
		"limited_to_own_queries": ch.UsingUserQueryLog(),
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

	// pretty=1 opts into the human-readable plan output (ClickHouse ≥ 26.3).
	pretty := r.URL.Query().Get("pretty") == "1"
	result, err := ch.GetExplain(r.Context(), query.Query, pretty)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// GetExplainAnalyze runs EXPLAIN ANALYZE, which re-executes the query to
// measure real per-step runtime metrics. It is deliberately a separate
// endpoint from GetExplain (which runs only planner-only variants) because
// the re-execution is potentially expensive and must be opt-in.
func (a *API) GetExplainAnalyze(w http.ResponseWriter, r *http.Request) {
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

	// Defence-in-depth: the clickhouse layer's isSelectLike guard is the
	// primary barrier, but since EXPLAIN ANALYZE re-executes the query we
	// also honour read-only mode here, mirroring ExecuteQuery.
	if isReadonly(r) && rejectWriteQuery(w, query.Query) {
		return
	}

	processors := r.URL.Query().Get("processors") == "1"

	result, err := ch.GetExplainAnalyze(r.Context(), query.Query, processors)
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

// executeStreamEvent is one NDJSON line of the /api/execute streaming
// response. The response always starts with a "started" event (flushed
// immediately, so reverse proxies see bytes right away and their read
// timeouts never fire), zero or more "progress" events, and exactly one
// terminal "result" or "error" event.
type executeStreamEvent struct {
	Type     string                    `json:"type"` // started | progress | result | error
	QueryID  string                    `json:"query_id,omitempty"`
	Progress *clickhouse.QueryProgress `json:"progress,omitempty"`
	Result   *clickhouse.QueryResult   `json:"result,omitempty"`
	Error    *ApiError                 `json:"error,omitempty"`
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
		Params   map[string]string `json:"params"`
		Tag      string            `json:"tag"`
		Detached bool              `json:"detached"`
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
	tag := sanitizeLogComment(req.Tag)

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

	// Detached mode: the statement runs in a background job decoupled from
	// this HTTP request — the structural fix for reverse-proxy timeouts on
	// very long queries. The browser polls /api/jobs/{id} for progress and
	// results. Must be handled before the NDJSON preamble switches this
	// response to event streaming.
	if req.Detached {
		a.startDetachedJob(w, r, ch, req.Query, limit, offset, req.Settings, req.Params, tag)
		return
	}

	// Everything below streams NDJSON. From here on, errors must be written
	// as events, not as non-200 JSON responses.
	queryID := clickhouse.NewQueryID()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	// Ask reverse proxies (nginx in particular) not to buffer this stream —
	// the whole point is that the browser sees events as they happen.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	var writeMu sync.Mutex
	writeEvent := func(ev executeStreamEvent) {
		b, err := json.Marshal(ev)
		if err != nil {
			return
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		if _, err := w.Write(append(b, '\n')); err != nil {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}

	writeEvent(executeStreamEvent{Type: "started", QueryID: queryID})

	// Per-statement budget. The route-level middleware only provides the
	// bulk backstop; this is where -query-timeout actually applies.
	ctx, cancel := context.WithTimeout(r.Context(), a.queryTimeout)
	defer cancel()

	// If the browser disconnects (or hits Cancel, which aborts the fetch),
	// the query would keep burning ClickHouse resources. Kill it. The
	// query_id is ours, so the KILL is precise. After normal completion the
	// watcher loses the select race at worst, and a KILL for an already
	// finished query_id is a harmless no-op.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-r.Context().Done():
			killCtx, killCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer killCancel()
			_ = ch.KillQuery(killCtx, queryID)
		case <-done:
		}
	}()

	// Progress pump: poll system.processes for our query_id every 2s and
	// stream snapshots. Every event also keeps bytes flowing through any
	// reverse proxy between the browser and ClickLens.
	progressStop := make(chan struct{})
	defer close(progressStop)
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-progressStop:
				return
			case <-ticker.C:
				pctx, pctxCancel := context.WithTimeout(context.Background(), 3*time.Second)
				p, err := ch.GetProgress(pctx, queryID)
				pctxCancel()
				if err == nil && p.IsRunning {
					writeEvent(executeStreamEvent{Type: "progress", QueryID: queryID, Progress: p})
				}
			}
		}
	}()

	result, err := ch.ExecuteQuery(ctx, clickhouse.ExecuteOptions{
		Query:      req.Query,
		Limit:      limit,
		Offset:     offset,
		Settings:   req.Settings,
		Params:     req.Params,
		LogComment: tag,
		QueryID:    queryID,
	})
	if err != nil {
		writeEvent(executeStreamEvent{Type: "error", QueryID: queryID, Error: apiErrorFromErr(err, a.queryTimeout)})
		return
	}
	// Advisor is best-effort, computed on the first page only (pagination
	// re-runs shouldn't re-derive it), and must never fail the query.
	if offset == 0 {
		actx, acancel := context.WithTimeout(context.Background(), 5*time.Second)
		result.Advisor = ch.AdviseForQuery(actx, req.Query)
		acancel()
	}
	writeEvent(executeStreamEvent{Type: "result", QueryID: queryID, Result: result})
}

// ExecuteCount runs the (formerly automatic) `SELECT count() FROM (user query)`
// as an explicit, user-initiated request. It returns the count in a normal
// JSON response — counts are cheap to wait for and there is no value in
// streaming them.
func (a *API) ExecuteCount(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	var req struct {
		Query string `json:"query"`
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

	ctx, cancel := context.WithTimeout(r.Context(), a.queryTimeout)
	defer cancel()
	n, err := ch.CountQueryRows(ctx, req.Query)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"count": n})
}

// RemoteTables lists remote-backed tables (S3/URL/Iceberg/…) with their
// 24h read load — used by the editor advisor and available standalone.
func (a *API) RemoteTables(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	tables, err := ch.ListRemoteTables(r.Context())
	if err != nil {
		respondErr(w, err, false)
		return
	}
	if tables == nil {
		tables = []clickhouse.RemoteTableInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tables": tables})
}

// ExecuteCancel kills an in-flight editor query by the query_id the browser
// received in the "started" stream event. Complements the fetch abort: the
// abort closes the pipe, this guarantees the server-side query stops too.
func (a *API) ExecuteCancel(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	var req struct {
		QueryID string `json:"query_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		InvalidBody(w, "")
		return
	}
	if req.QueryID == "" {
		MissingParam(w, "query_id")
		return
	}
	if err := ch.KillQuery(r.Context(), req.QueryID); err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "killed", "query_id": req.QueryID})
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

// SchemaGraph serves the table/dependency graph for the schema visualizer.
// load_days (0|1|7|30) optionally aggregates system.query_views_log into a
// per-MV load heat-map.
func (a *API) SchemaGraph(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}
	loadDays := 0
	if v := r.URL.Query().Get("load_days"); v != "" {
		loadDays, _ = strconv.Atoi(v)
		if loadDays < 0 {
			loadDays = 0
		}
		if loadDays > 30 {
			loadDays = 30
		}
	}
	dbFilter := r.URL.Query().Get("database")
	includeAll := r.URL.Query().Get("all") == "1"
	graph, err := ch.GetSchemaGraph(r.Context(), loadDays, dbFilter, includeAll)
	if err != nil {
		respondErr(w, err, false)
		return
	}
	writeJSON(w, http.StatusOK, graph)
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
	if isReadonly(r) {
		Forbidden(w, "KILL QUERY is not allowed in read-only mode")
		return
	}
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
	if isReadonly(r) {
		Forbidden(w, "KILL QUERY is not allowed in read-only mode")
		return
	}
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
	hideSystem := r.URL.Query().Get("hide_system_queries") != "false"

	queries, total, err := ch.ListFingerprintQueries(r.Context(), hash, limit, offset, hideSystem)
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
	if isReadonly(r) {
		Forbidden(w, "KILL MUTATION is not allowed in read-only mode")
		return
	}
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
	if isReadonly(r) {
		Forbidden(w, "DROP USER is not allowed in read-only mode")
		return
	}
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
	if isReadonly(r) {
		Forbidden(w, "DROP ROLE is not allowed in read-only mode")
		return
	}
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
	if isReadonly(r) {
		Forbidden(w, "REVOKE is not allowed in read-only mode")
		return
	}
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
	if !clickhouse.ValidAccessType(req.AccessType) {
		InvalidParam(w, "access_type", "only known privilege keywords (SELECT, INSERT, ALTER, …) and optional column lists are allowed")
		return
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
