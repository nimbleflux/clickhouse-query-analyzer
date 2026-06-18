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

// GetConfig returns server-side default connection settings so the frontend
// can pre-fill the connection form. The password is never exposed — only a
// boolean indicating whether one is configured server-side.
func (a *API) GetConfig(w http.ResponseWriter, r *http.Request) {
	if a.defaultURL == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"default_connection": map[string]interface{}{
			"url":          a.defaultURL,
			"user":         a.defaultUser,
			"database":     a.defaultDatabase,
			"has_password": a.defaultPassword != "",
			"skip_tls":     false,
		},
	})
}
