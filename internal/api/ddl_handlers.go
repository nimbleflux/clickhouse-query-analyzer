package api

import (
	"net/http"
	"strconv"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func (a *API) GetDDL(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, false, err)
		return
	}

	params := clickhouse.DDLParams{Database: r.URL.Query().Get("database")}
	if v := r.URL.Query().Get("limit"); v != "" {
		params.Limit, _ = strconv.Atoi(v)
	}

	status, err := ch.GetDDL(r.Context(), params)
	if err != nil {
		respondErr(w, err, false)
		return
	}

	writeJSON(w, http.StatusOK, status)
}
