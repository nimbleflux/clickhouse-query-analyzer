package api

import (
	"net/http"
	"strconv"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func (a *API) GetReplication(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	params := clickhouse.ReplicationParams{
		Database:       r.URL.Query().Get("database"),
		ErrorsOnly:     r.URL.Query().Get("errors_only") == "1",
		ExecutingOnly:  r.URL.Query().Get("executing_only") == "1",
		IncludeHistory: r.URL.Query().Get("include_history") != "false",
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		params.Limit, _ = strconv.Atoi(v)
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		params.Offset, _ = strconv.Atoi(v)
	}

	status, err := ch.GetReplication(r.Context(), params)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, status)
}
