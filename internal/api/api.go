package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		w.Write([]byte("null"))
		return
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice && rv.IsNil() {
		w.Write([]byte("[]"))
		return
	}
	json.NewEncoder(w).Encode(v)
}

type API struct {
	pool *clickhouse.Pool
}

func New(pool *clickhouse.Pool) *API {
	return &API{pool: pool}
}

func (a *API) clientFromRequest(r *http.Request) (*clickhouse.Client, error) {
	params := clickhouse.ConnParams{
		URL:      r.Header.Get("X-CH-URL"),
		User:     r.Header.Get("X-CH-User"),
		Password: r.Header.Get("X-CH-Password"),
		Database: r.Header.Get("X-CH-Database"),
		SkipTLS:  r.Header.Get("X-CH-Skip-TLS") == "1",
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

func rejectWriteQuery(w http.ResponseWriter, query string) bool {
	upper := strings.ToUpper(query)
	for _, prefix := range readOnlyPrefixes {
		if strings.HasPrefix(strings.TrimSpace(upper), prefix) {
			Forbidden(w, fmt.Sprintf("Query rejected: read-only mode is enabled (%s not allowed)", strings.TrimSpace(prefix)))
			return true
		}
	}
	if strings.HasPrefix(strings.TrimSpace(upper), "EXPLAIN") {
		return false
	}
	return false
}
