package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

// job is one detached execution. It is the structural answer to reverse-proxy
// timeouts: the HTTP request that started the query ends immediately, the
// query keeps running server-side under a ClickLens-owned context, and the
// browser polls for progress and the final result. Works on any ClickHouse
// version.
type job struct {
	mu         sync.Mutex
	ID         string                    `json:"id"`
	QueryID    string                    `json:"query_id"`
	Statement  string                    `json:"statement"`
	Status     string                    `json:"status"` // running | done | error | canceled
	Result     *clickhouse.QueryResult   `json:"result,omitempty"`
	Error      *ApiError                 `json:"error,omitempty"`
	Progress   *clickhouse.QueryProgress `json:"progress,omitempty"`
	StartedAt  time.Time                 `json:"started_at"`
	FinishedAt *time.Time                `json:"finished_at,omitempty"`

	client *clickhouse.Client
	cancel context.CancelFunc
}

// jobView is the JSON-serializable job state handed to handlers — the job's
// mutex and live fields never cross a copy boundary.
type jobView struct {
	ID         string                    `json:"id"`
	QueryID    string                    `json:"query_id"`
	Statement  string                    `json:"statement"`
	Status     string                    `json:"status"` // running | done | error | canceled
	Result     *clickhouse.QueryResult   `json:"result,omitempty"`
	Error      *ApiError                 `json:"error,omitempty"`
	Progress   *clickhouse.QueryProgress `json:"progress,omitempty"`
	StartedAt  time.Time                 `json:"started_at"`
	FinishedAt *time.Time                `json:"finished_at,omitempty"`
}

// snapshot returns the job state for JSON serialization. Progress is
// refreshed live from system.processes while the job is running.
func (j *job) snapshot(withProgress bool) *jobView {
	j.mu.Lock()
	defer j.mu.Unlock()
	view := &jobView{
		ID:         j.ID,
		QueryID:    j.QueryID,
		Statement:  j.Statement,
		Status:     j.Status,
		Result:     j.Result,
		Error:      j.Error,
		StartedAt:  j.StartedAt,
		FinishedAt: j.FinishedAt,
	}
	if withProgress && j.Status == "running" && j.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		if p, err := j.client.GetProgress(ctx, j.QueryID); err == nil {
			view.Progress = p
		}
		cancel()
	}
	return view
}

func (j *job) finished() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.Status != "running"
}

func (j *job) finish(result *clickhouse.QueryResult, apiErr *ApiError, canceled bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	now := time.Now()
	j.FinishedAt = &now
	if canceled {
		j.Status = "canceled"
	} else if apiErr != nil {
		j.Status = "error"
		j.Error = apiErr
	} else {
		j.Status = "done"
		j.Result = result
	}
}

const (
	maxJobs          = 50
	jobResultTTL     = 30 * time.Minute
	jobBudget        = 30 * time.Minute
	statementPreview = 160
)

type jobStore struct {
	mu   sync.Mutex
	jobs map[string]*job
}

func newJobStore() *jobStore { return &jobStore{jobs: make(map[string]*job)} }

func (s *jobStore) get(id string) (*job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	return j, ok
}

func (s *jobStore) put(j *job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Evict finished jobs past the TTL, then make room by dropping the
	// oldest finished job.
	now := time.Now()
	for id, existing := range s.jobs {
		if existing.finishedAt().After(now.Add(-jobResultTTL)) && existing.finishedAt().Before(now) {
			// not yet expired
			continue
		}
		if !existing.finishedAt().IsZero() && now.Sub(existing.finishedAt()) > jobResultTTL {
			delete(s.jobs, id)
		}
	}
	for len(s.jobs) >= maxJobs {
		oldestID := ""
		var oldest time.Time
		for id, existing := range s.jobs {
			ft := existing.finishedAt()
			if ft.IsZero() {
				continue // still running — never evict those
			}
			if oldestID == "" || ft.Before(oldest) {
				oldestID = id
				oldest = ft
			}
		}
		if oldestID == "" {
			break
		}
		delete(s.jobs, oldestID)
	}
	s.jobs[j.ID] = j
}

func (s *jobStore) list() []*job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*job, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, j)
	}
	return out
}

func (j *job) finishedAt() time.Time {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.FinishedAt == nil {
		return time.Time{}
	}
	return *j.FinishedAt
}

// startDetachedJob launches the statement in a background goroutine and
// answers with the job id immediately. The request's connection context does
// not reach the query: disconnecting the browser does NOT cancel it (that is
// the point) — only an explicit cancel does.
func (a *API) startDetachedJob(w http.ResponseWriter, r *http.Request, ch *clickhouse.Client, query string, limit, offset int, settings, params map[string]string) {
	ctx, cancel := context.WithTimeout(context.Background(), jobBudget)
	queryID := clickhouse.NewQueryID()
	j := &job{
		ID:        "job_" + clickhouse.NewQueryID()[:16],
		QueryID:   queryID,
		Statement: previewStatement(query),
		Status:    "running",
		StartedAt: time.Now(),
		client:    ch,
		cancel:    cancel,
	}
	a.jobs.put(j)

	go func() {
		defer cancel()
		result, err := ch.ExecuteQuery(ctx, clickhouse.ExecuteOptions{
			Query:    query,
			Limit:    limit,
			Offset:   offset,
			Settings: settings,
			Params:   params,
			QueryID:  queryID,
		})
		if err != nil {
			j.finish(nil, apiErrorFromErr(err, jobBudget), ctx.Err() == context.Canceled)
			return
		}
		j.finish(result, nil, false)
	}()

	writeJSON(w, http.StatusOK, map[string]string{
		"job_id":   j.ID,
		"query_id": queryID,
		"status":   j.Status,
	})
}

func previewStatement(q string) string {
	q = clickhouse.StripLeadingComments(q)
	if len(q) > statementPreview {
		return q[:statementPreview] + "…"
	}
	return q
}

func (a *API) ListJobs(w http.ResponseWriter, r *http.Request) {
	jobs := a.jobs.list()
	out := make([]*jobView, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, j.snapshot(false))
	}
	writeJSON(w, http.StatusOK, out)
}

// GetJob returns the job status, a live progress snapshot (while running)
// and the buffered result once done.
func (a *API) GetJob(w http.ResponseWriter, r *http.Request) {
	j, ok := a.jobs.get(chi.URLParam(r, "jobID"))
	if !ok {
		NotFound(w, "job")
		return
	}
	writeJSON(w, http.StatusOK, j.snapshot(true))
}

func (a *API) CancelJob(w http.ResponseWriter, r *http.Request) {
	j, ok := a.jobs.get(chi.URLParam(r, "jobID"))
	if !ok {
		NotFound(w, "job")
		return
	}
	if j.finished() {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already finished"})
		return
	}
	// Cancel the job context (aborts the HTTP request to ClickHouse) and
	// KILL the query for certainty, mirroring the editor Stop path.
	j.mu.Lock()
	cancel := j.cancel
	client := j.client
	queryID := j.QueryID
	j.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if client != nil {
		killCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		_ = client.KillQuery(killCtx, queryID)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "canceling", "query_id": queryID})
}
