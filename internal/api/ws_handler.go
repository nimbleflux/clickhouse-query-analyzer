package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/nimbleflux/clickhouse-query-analyzer/internal/clickhouse"
)

func (a *API) LiveMonitor(w http.ResponseWriter, r *http.Request) {
	ch, err := a.clientFromRequest(r)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "")
			return
		case <-ticker.C:
			queries, total, err := ch.ListQueries(ctx, clickhouse.QueryListParams{
				Limit:   20,
				SortBy:  "query_start_time",
				SortDir: "DESC",
			})
			if err != nil {
				msg, _ := json.Marshal(map[string]string{"error": err.Error()})
				conn.Write(ctx, websocket.MessageText, msg)
				continue
			}

			msg, _ := json.Marshal(map[string]interface{}{
				"queries": queries,
				"total":   total,
			})
			if err := conn.Write(ctx, websocket.MessageText, msg); err != nil {
				return
			}
		}
	}
}
