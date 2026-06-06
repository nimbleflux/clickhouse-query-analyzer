package api

import (
	"net/http"
)

func (a *API) ConnectWithInfo(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		CHUnreachable(w, true, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":     "ok",
		"cluster":    ch.Cluster(),
		"is_cluster": ch.IsCluster(),
	})
}
