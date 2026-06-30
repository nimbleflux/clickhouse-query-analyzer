package clickhouse

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type ColumnInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// extractHTTPCode pulls the leading "Code: N" out of a ClickHouse HTTP
// error body. Returns 0 if no code is present.
func extractHTTPCode(body string) ClickHouseErrorCode {
	idx := strings.Index(body, "Code:")
	if idx < 0 {
		return CHUnknown
	}
	rest := body[idx+len("Code:"):]
	rest = strings.TrimLeft(rest, " \t")
	end := 0
	for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
		end++
	}
	if end == 0 {
		return CHUnknown
	}
	n, err := strconv.Atoi(rest[:end])
	if err != nil {
		return CHUnknown
	}
	return ClickHouseErrorCode(n)
}

type QueryResult struct {
	Columns   []ColumnInfo     `json:"columns"`
	Rows      []map[string]any `json:"rows"`
	RowCount  int              `json:"row_count"`
	TotalRows int64            `json:"total_rows"`
	TimingMs  int64            `json:"timing_ms"`
	QueryID   string           `json:"query_id"`
}

// isSelectLike returns true if the query looks like a SELECT (or WITH/EXPLAIN/VALUES)
// that returns rows and can therefore be wrapped for pagination. Non-SELECT
// statements (INSERT, CREATE, DROP, ALTER, SET, USE, …) are executed as-is.
func isSelectLike(query string) bool {
	trimmed := strings.TrimSpace(query)
	// strip a leading SQL line comment
	for strings.HasPrefix(trimmed, "--") {
		nl := strings.IndexByte(trimmed, '\n')
		if nl < 0 {
			return false
		}
		trimmed = strings.TrimSpace(trimmed[nl+1:])
	}
	upper := strings.ToUpper(trimmed)
	switch {
	case strings.HasPrefix(upper, "SELECT"),
		strings.HasPrefix(upper, "WITH"),
		strings.HasPrefix(upper, "EXPLAIN"),
		strings.HasPrefix(upper, "VALUES"),
		strings.HasPrefix(upper, "SHOW"),
		strings.HasPrefix(upper, "DESCRIBE"),
		strings.HasPrefix(upper, "DESC"):
		return true
	}
	return false
}

func (c *Client) ExecuteQuery(ctx context.Context, query string, limit, offset int, settings map[string]string) (*QueryResult, error) {
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	selectLike := isSelectLike(query)

	// For SELECT-like queries, wrap in a subquery to apply a deterministic
	// LIMIT/OFFSET window. For everything else (DDL/DML), execute verbatim
	// with a max_result_rows ceiling as defense-in-depth.
	var executedQuery string
	if selectLike {
		executedQuery = fmt.Sprintf("SELECT * FROM (%s) LIMIT %d OFFSET %d", query, limit, offset)
	} else {
		executedQuery = query
	}

	httpURL, err := c.httpURL()
	if err != nil {
		return nil, err
	}

	start := time.Now()

	u, _ := url.Parse(httpURL)
	q := u.Query()
	for k, v := range settings {
		q.Set(k, v)
	}
	// Apply defense-in-depth limits AFTER user settings so they can't be
	// overridden by the client (e.g. sending max_result_rows=999999999).
	q.Set("max_result_rows", fmt.Sprintf("%d", limit))
	q.Set("result_overflow_mode", "break")
	u.RawQuery = q.Encode()

	body := bytes.NewBufferString(executedQuery)
	req, err := http.NewRequestWithContext(ctx, "POST", u.String(), body)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "text/plain")

	resp, err := c.getHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing query: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return nil, &CHError{
			Code:    extractHTTPCode(string(b)),
			Message: strings.TrimSpace(string(b)),
		}
	}

	dec := json.NewDecoder(resp.Body)

	var names []string
	if !dec.More() {
		return &QueryResult{
			Columns:   []ColumnInfo{},
			Rows:      []map[string]any{},
			RowCount:  0,
			TotalRows: -1,
			TimingMs:  time.Since(start).Milliseconds(),
			QueryID:   resp.Header.Get("X-ClickHouse-Query-Id"),
		}, nil
	}

	var namesRaw []json.RawMessage
	if err := dec.Decode(&namesRaw); err != nil {
		return nil, fmt.Errorf("parsing column names: %w", err)
	}
	for _, r := range namesRaw {
		var name string
		json.Unmarshal(r, &name)
		names = append(names, name)
	}

	var types []string
	if !dec.More() {
		return &QueryResult{
			Columns:   columnsFromNamesTypes(names, nil),
			Rows:      []map[string]any{},
			RowCount:  0,
			TotalRows: -1,
			TimingMs:  time.Since(start).Milliseconds(),
			QueryID:   resp.Header.Get("X-ClickHouse-Query-Id"),
		}, nil
	}
	var typesRaw []json.RawMessage
	if err := dec.Decode(&typesRaw); err != nil {
		return nil, fmt.Errorf("parsing column types: %w", err)
	}
	for _, r := range typesRaw {
		var t string
		json.Unmarshal(r, &t)
		types = append(types, t)
	}

	columns := columnsFromNamesTypes(names, types)

	var result []map[string]any
	rowIdx := 0
	for dec.More() {
		var vals []json.RawMessage
		if err := dec.Decode(&vals); err != nil {
			break
		}
		row := make(map[string]any, len(names))
		for i, name := range names {
			if i < len(vals) {
				var v any
				if err := json.Unmarshal(vals[i], &v); err != nil {
					var s string
					json.Unmarshal(vals[i], &s)
					v = s
				}
				row[name] = v
			}
		}
		result = append(result, row)
		rowIdx++
		if rowIdx >= limit {
			break
		}
	}

	queryID := resp.Header.Get("X-ClickHouse-Query-Id")
	elapsed := time.Since(start).Milliseconds()

	if result == nil {
		result = []map[string]any{}
	}

	// Total row count: only compute for SELECT-like queries, and only on the
	// first page (offset 0) to amortize the cost. Cached client-side thereafter.
	// Returns -1 (unknown) if the count query fails or the query isn't SELECT-like.
	totalRows := int64(-1)
	if selectLike && offset == 0 {
		countQuery := fmt.Sprintf("SELECT count() FROM (%s)", query)
		var n uint64
		if err := c.conn.QueryRow(ctx, countQuery).Scan(&n); err == nil {
			totalRows = int64(n)
		}
	}

	return &QueryResult{
		Columns:   columns,
		Rows:      result,
		RowCount:  len(result),
		TotalRows: totalRows,
		TimingMs:  elapsed,
		QueryID:   queryID,
	}, nil
}

func columnsFromNamesTypes(names []string, types []string) []ColumnInfo {
	cols := make([]ColumnInfo, len(names))
	for i, n := range names {
		cols[i] = ColumnInfo{Name: n}
		if i < len(types) {
			cols[i].Type = types[i]
		}
	}
	return cols
}

func nativeToHTTPPort(nativePort string) string {
	switch nativePort {
	case "9000", "":
		return "8123"
	case "9440":
		return "8443"
	default:
		n, err := strconv.Atoi(nativePort)
		if err != nil {
			return "8123"
		}
		return fmt.Sprintf("%d", n-877)
	}
}

func (c *Client) getHTTPClient() *http.Client {
	return c.httpClient
}

func (c *Client) httpURL() (string, error) {
	if c.connURL == "" {
		return "", fmt.Errorf("connection URL not available")
	}
	u, err := url.Parse(c.connURL)
	if err != nil {
		return "", fmt.Errorf("parsing URL: %w", err)
	}

	if c.isHTTP {
		u.User = url.UserPassword(c.connUser, c.connPass)
		u.Path = "/"
		q := u.Query()
		q.Set("default_format", "JSONCompactEachRowWithNamesAndTypes")
		u.RawQuery = q.Encode()
		return u.String(), nil
	}

	switch u.Scheme {
	case "clickhouse":
		u.Scheme = "http"
	case "clickhouses":
		u.Scheme = "https"
	}
	host := u.Hostname()
	u.Host = host + ":" + nativeToHTTPPort(u.Port())
	u.User = url.UserPassword(c.connUser, c.connPass)
	u.Path = "/"
	q := u.Query()
	q.Set("default_format", "JSONCompactEachRowWithNamesAndTypes")
	u.RawQuery = q.Encode()
	return u.String(), nil
}

type TableInfo struct {
	Name     string       `json:"name"`
	Engine   string       `json:"engine"`
	RowCount uint64       `json:"row_count"`
	Columns  []ColumnInfo `json:"columns"`
}

type DatabaseInfo struct {
	Name   string      `json:"name"`
	Tables []TableInfo `json:"tables"`
}

type SchemaInfo struct {
	Databases []DatabaseInfo `json:"databases"`
}

func (c *Client) GetDatabases(ctx context.Context) ([]string, error) {
	rows, err := c.conn.Query(ctx, "SELECT name FROM system.databases WHERE name NOT IN ('INFORMATION_SCHEMA', 'information_schema') ORDER BY name")
	if err != nil {
		return nil, fmt.Errorf("querying databases: %w", err)
	}
	defer rows.Close()
	var databases []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		databases = append(databases, name)
	}
	return databases, nil
}

func (c *Client) GetTables(ctx context.Context, database string) ([]TableInfo, error) {
	tRows, err := c.conn.Query(ctx, "SELECT name, engine, total_rows FROM system.tables WHERE database = ? ORDER BY name", database)
	if err != nil {
		return nil, err
	}
	defer tRows.Close()
	var tables []TableInfo
	for tRows.Next() {
		var name, engine string
		var totalRows uint64
		if err := tRows.Scan(&name, &engine, &totalRows); err != nil {
			return nil, err
		}
		tables = append(tables, TableInfo{Name: name, Engine: engine, RowCount: totalRows})
	}
	return tables, nil
}

func (c *Client) GetColumns(ctx context.Context, database, table string) ([]ColumnInfo, error) {
	cRows, err := c.conn.Query(ctx, "SELECT name, type FROM system.columns WHERE database = ? AND table = ? ORDER BY position", database, table)
	if err != nil {
		return nil, err
	}
	defer cRows.Close()

	var columns []ColumnInfo
	for cRows.Next() {
		var name, typ string
		if err := cRows.Scan(&name, &typ); err != nil {
			return nil, err
		}
		columns = append(columns, ColumnInfo{Name: name, Type: typ})
	}
	return columns, nil
}

func isProbablyJSON(s string) bool {
	s = strings.TrimSpace(s)
	return len(s) > 0 && (s[0] == '{' || s[0] == '[')
}

// GetTableDDL returns the SHOW CREATE statement for a table. Identifiers are
// quoted (they come from system tables but may be reserved words).
func (c *Client) GetTableDDL(ctx context.Context, database, table string) (string, error) {
	var stmt string
	q := fmt.Sprintf("SHOW CREATE TABLE %s.%s", quoteIdent(database), quoteIdent(table))
	if err := c.conn.QueryRow(ctx, q).Scan(&stmt); err != nil {
		return "", fmt.Errorf("show create %s.%s: %w", database, table, err)
	}
	return stmt, nil
}
