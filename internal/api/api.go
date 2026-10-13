package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
	"github.com/nimbleflux/clickhouse-query-analyzer/internal/config"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	// Keep nil slices as [] — handlers don't all normalize, and the frontend
	// maps over responses directly.
	if v != nil {
		rv := reflect.ValueOf(v)
		if rv.Kind() == reflect.Slice && rv.IsNil() {
			v = []any{}
		}
	}
	// Marshal before touching the ResponseWriter: if encoding fails (e.g. a
	// NaN slipped through), headers haven't been sent yet and we can still
	// return a well-formed 500 instead of an empty 200 the frontend then
	// chokes on with "unexpected end of data".
	b, err := json.Marshal(v)
	if err != nil {
		slog.Error("encoding JSON response", "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"response encoding failed","code":"INTERNAL","retry":false}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b)
}

type API struct {
	pool            *clickhouse.Pool
	defaultURL      string
	defaultUser     string
	defaultPassword string
	defaultDatabase string
	// queryTimeout bounds a single ad-hoc editor statement (and single-table
	// optimizer analyses). Configurable via -query-timeout / QUERY_TIMEOUT.
	queryTimeout time.Duration
	// hideDefaultConnection suppresses default_connection in /api/config.
	hideDefaultConnection bool
	// jobs tracks detached executions (run decoupled from the HTTP request).
	jobs *jobStore
}

func New(pool *clickhouse.Pool, cfg *config.Config) *API {
	api := &API{pool: pool, queryTimeout: 120 * time.Second, jobs: newJobStore()}
	if cfg != nil {
		api.defaultURL = cfg.ClickHouseURL
		api.defaultUser = cfg.ClickHouseUser
		api.defaultPassword = cfg.ClickHousePass
		api.defaultDatabase = cfg.ClickHouseDB
		api.hideDefaultConnection = cfg.HideDefaultConnection
		if cfg.QueryTimeout > 0 {
			api.queryTimeout = cfg.QueryTimeout
		}
	}
	return api
}

func (a *API) clientFromRequest(r *http.Request) (*clickhouse.Client, error) {
	params := clickhouse.ConnParams{
		URL:      r.Header.Get("X-CH-URL"),
		User:     r.Header.Get("X-CH-User"),
		Password: r.Header.Get("X-CH-Password"),
		Database: r.Header.Get("X-CH-Database"),
		SkipTLS:  r.Header.Get("X-CH-Skip-TLS") == "1",
	}
	// Fall back to server-side defaults (from env vars / CLI flags) when the
	// browser didn't provide a value. This lets operators pre-configure the
	// connection so users don't have to enter anything.
	if params.URL == "" {
		params.URL = a.defaultURL
	}
	if params.User == "" {
		params.User = a.defaultUser
	}
	if params.Password == "" {
		params.Password = a.defaultPassword
	}
	if params.Database == "" {
		params.Database = a.defaultDatabase
	}
	if params.User == "" {
		params.User = "default"
	}
	if params.Database == "" {
		params.Database = "system"
	}
	if params.URL == "" {
		return nil, fmt.Errorf("ClickHouse URL not configured. Provide X-CH-URL header or configure connection in the UI")
	}
	return a.pool.Get(r.Context(), params)
}

func isReadonly(r *http.Request) bool {
	return r.Header.Get("X-CH-Readonly") == "1"
}

var readOnlyPrefixes = []string{
	"INSERT ", "ALTER ", "DROP ", "CREATE ", "TRUNCATE ", "KILL ",
	"SYSTEM ", "OPTIMIZE ", "DETACH ", "ATTACH ", "RENAME ",
	"GRANT ", "REVOKE ", "DELETE ", "UPDATE ",
}

// rejectWriteQuery rejects obvious write statements in read-only mode.
// Leading comments are stripped first — `/* x */ DROP TABLE t` used to slip
// past the prefix check. This is UX-grade defense in depth; real read-only
// enforcement is a read-only ClickHouse user.
func rejectWriteQuery(w http.ResponseWriter, query string) bool {
	stripped := clickhouse.StripLeadingComments(query)
	if stripped == "" {
		// Comment-only or unterminated comment: nothing sensible to run.
		Forbidden(w, "Query rejected: read-only mode is enabled (query has no statement)")
		return true
	}
	upper := strings.ToUpper(stripped)
	for _, prefix := range readOnlyPrefixes {
		if strings.HasPrefix(strings.TrimSpace(upper), prefix) {
			Forbidden(w, fmt.Sprintf("Query rejected: read-only mode is enabled (%s not allowed)", strings.TrimSpace(prefix)))
			return true
		}
	}
	return false
}
