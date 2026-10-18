package clickhouse

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// remoteEngines are table engines that read data over the network at query
// time (object storage, HTTP, HDFS, external databases). Queries touching
// them can be slow and expensive in ways local tables never are: every scan
// is a remote read, LIMIT only short-circuits streaming reads, and EXPLAIN
// ESTIMATE reports zero rows. The advisor surfaces this in the editor.
var remoteEngines = map[string]bool{
	"S3":                      true,
	"S3Cluster":               true,
	"URL":                     true,
	"Iceberg":                 true,
	"IcebergCluster":          true,
	"DeltaLake":               true,
	"DataLakeCatalog":         true,
	"HDFS":                    true,
	"HDFSCluster":             true,
	"AzureBlobStorage":        true,
	"AzureBlobStorageCluster": true,
	// External databases: every query reads over the network too.
	"PostgreSQL": true,
	"MySQL":      true,
	"MongoDB":    true,
	"Redis":      true,
	"SQLite":     true,
	"JDBC":       true,
	"ODBC":       true,
}

// RemoteTableInfo describes a remote-backed table plus its recent read load.
type RemoteTableInfo struct {
	Database  string `json:"database"`
	Table     string `json:"table"`
	Engine    string `json:"engine"`
	TotalRows uint64 `json:"total_rows"` // often 0 for object-storage engines
	// 24h load from system.query_log (0 when query_log is unavailable).
	Queries24h uint64 `json:"queries_24h"`
	ReadRows   uint64 `json:"read_rows_24h"`
	ReadBytes  uint64 `json:"read_bytes_24h"`
}

// QueryAdvisor is attached to editor results when the executed SQL may read
// remote-backed tables.
type QueryAdvisor struct {
	// Tables the query text may reference (qualified or bare name match).
	Tables []RemoteTableInfo `json:"tables"`
	// Warnings are short human-readable strings rendered above the result.
	Warnings []string `json:"warnings"`
	// Suggestions are quick actions the UI can offer (e.g. "add LIMIT 1000").
	Suggestions []string `json:"suggestions"`
}

// advisorCache memoizes the remote-table list per connection for a few
// minutes — the editor calls the advisor on every run, and system.tables
// is not free on instances with thousands of tables. The zero value is
// ready to use; c.advisor itself is initialized at connect time (see
// client.go) so concurrent editor runs never race on the pointer.
type advisorCache struct {
	mu        sync.Mutex
	tables    []RemoteTableInfo
	fetchedAt time.Time
}

const advisorCacheTTL = 5 * time.Minute

func (c *Client) cachedRemoteTables(ctx context.Context) ([]RemoteTableInfo, error) {
	c.advisor.mu.Lock()
	if c.advisor.tables != nil && time.Since(c.advisor.fetchedAt) < advisorCacheTTL {
		tables := c.advisor.tables
		c.advisor.mu.Unlock()
		return tables, nil
	}
	c.advisor.mu.Unlock()

	// Fetch OUTSIDE the lock: ListRemoteTables includes the per-table 24h
	// stats (N queries) — holding the lock through it serialized every
	// concurrent editor "Run" behind one slow refresh.
	tables, err := c.ListRemoteTables(ctx)

	c.advisor.mu.Lock()
	defer c.advisor.mu.Unlock()
	if err != nil {
		// Serve the stale list rather than nagging the user on every run.
		if c.advisor.tables != nil {
			return c.advisor.tables, nil
		}
		return nil, err
	}
	c.advisor.tables = tables
	c.advisor.fetchedAt = time.Now()
	return tables, nil
}

// ListRemoteTables returns all remote-engine tables with best-effort 24h
// read stats from query_log.
func (c *Client) ListRemoteTables(ctx context.Context) ([]RemoteTableInfo, error) {
	engineList := make([]string, 0, len(remoteEngines))
	for e := range remoteEngines {
		engineList = append(engineList, quoteStr(e))
	}
	q := fmt.Sprintf(`
		SELECT database, name, engine, total_rows
		FROM system.tables
		WHERE engine IN (%s)
		ORDER BY database, name`, strings.Join(engineList, ", "))

	rows, err := c.conn.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("listing remote tables: %w", err)
	}
	defer rows.Close()

	var tables []RemoteTableInfo
	for rows.Next() {
		var t RemoteTableInfo
		if err := rows.Scan(&t.Database, &t.Table, &t.Engine, &t.TotalRows); err != nil {
			continue
		}
		tables = append(tables, t)
	}

	// Best-effort 24h load from query_log. Failure (access denied, missing
	// table) just leaves the stats at zero.
	c.attachRemoteTableStats(ctx, tables)
	return tables, nil
}

// remoteStatsWorkers bounds the per-table 24h query_log stat queries. They
// used to run strictly sequentially under the advisor lock; a server with 40
// remote tables paid 40 sequential 24h scans on the first editor run.
const remoteStatsWorkers = 4

func (c *Client) attachRemoteTableStats(ctx context.Context, tables []RemoteTableInfo) {
	if len(tables) == 0 {
		return
	}
	sem := make(chan struct{}, remoteStatsWorkers)
	var wg sync.WaitGroup
	for i := range tables {
		t := &tables[i]
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			// query_log.tables holds qualified names ("db.table"); has()
			// prunes on the array directly. Top-level read_rows/read_bytes
			// exist on every version, unlike per-engine ProfileEvents.
			q := fmt.Sprintf(`
				SELECT count(), sum(read_rows), sum(read_bytes)
				FROM %s
				WHERE event_time >= now() - INTERVAL 24 HOUR
				  AND type = 'QueryFinish'
				  AND has(tables, ?)`, c.tableRef("query_log"))
			ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			var queries, readRows, readBytes uint64
			if err := c.conn.QueryRow(ctx2, q, t.Database+"."+t.Table).Scan(&queries, &readRows, &readBytes); err == nil {
				t.Queries24h = queries
				t.ReadRows = readRows
				t.ReadBytes = readBytes
			}
		}()
	}
	wg.Wait()
}

// AdviseForQuery checks the query text against the remote-backed tables on
// this server and returns warnings/suggestions for the editor. Failures are
// swallowed — advice is best-effort and must never block execution.
func (c *Client) AdviseForQuery(ctx context.Context, query string) *QueryAdvisor {
	tables, err := c.cachedRemoteTables(ctx)
	if err != nil || len(tables) == 0 {
		return nil
	}
	if !isSelectLike(query) {
		return nil
	}

	matched := matchRemoteTables(query, tables)
	if len(matched) == 0 {
		return nil
	}

	advisor := &QueryAdvisor{Tables: matched}
	names := make([]string, len(matched))
	for i, t := range matched {
		names[i] = fmt.Sprintf("%s.%s (engine %s)", t.Database, t.Table, t.Engine)
	}

	advisor.Warnings = append(advisor.Warnings,
		fmt.Sprintf("This query appears to read remote-backed table(s): %s. Scans fetch data over the network at query time and can be slow or expensive.", strings.Join(names, ", ")))

	upper := strings.ToUpper(strings.TrimSpace(query))
	if !strings.Contains(upper, "WHERE") {
		advisor.Warnings = append(advisor.Warnings,
			"No WHERE clause: every column of every remote object may be read. Filters that prune files or columns cut both latency and cost.")
		advisor.Suggestions = append(advisor.Suggestions, "add_where")
	}
	if !strings.Contains(upper, "LIMIT") {
		advisor.Suggestions = append(advisor.Suggestions, "add_limit")
	}
	if len(matched) > 0 && anyEngine(matched, "S3", "URL", "AzureBlobStorage", "HDFS") {
		advisor.Suggestions = append(advisor.Suggestions, "set_max_execution_time")
	}
	return advisor
}

func matchRemoteTables(query string, tables []RemoteTableInfo) []RemoteTableInfo {
	upper := strings.ToUpper(query)
	var matched []RemoteTableInfo
	for _, t := range tables {
		qualified := strings.ToUpper(t.Database + "." + t.Table)
		if strings.Contains(upper, qualified) || containsWord(upper, strings.ToUpper(t.Table)) {
			matched = append(matched, t)
		}
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].Table < matched[j].Table })
	return matched
}

// containsWord reports whether s contains word delimited by non-identifier
// characters (so table "events" doesn't match "events_v2").
func containsWord(s, word string) bool {
	for i := 0; i+len(word) <= len(s); i++ {
		if s[i:i+len(word)] != word {
			continue
		}
		before := byte(' ')
		if i > 0 {
			before = s[i-1]
		}
		after := byte(' ')
		if i+len(word) < len(s) {
			after = s[i+len(word)]
		}
		if !isIdentChar(before) && !isIdentChar(after) {
			return true
		}
	}
	return false
}

func isIdentChar(b byte) bool {
	return b == '_' || b == '`' || b == '"' || (b >= '0' && b <= '9') || (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

func anyEngine(tables []RemoteTableInfo, engines ...string) bool {
	for _, t := range tables {
		for _, e := range engines {
			if t.Engine == e {
				return true
			}
		}
	}
	return false
}
