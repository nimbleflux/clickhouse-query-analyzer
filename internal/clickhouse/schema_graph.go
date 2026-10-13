package clickhouse

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

// SchemaKind classifies a table for the schema graph the same way
// ClickHouse's own /schema visualizer does, plus a Remote kind for
// object-storage engines (ties into the remote-table advisor coloring).
type SchemaKind string

const (
	KindMergeTree   SchemaKind = "mergetree"
	KindMV          SchemaKind = "mv"
	KindRefreshable SchemaKind = "rmv"
	KindDictionary  SchemaKind = "dictionary"
	KindDistributed SchemaKind = "distributed"
	KindView        SchemaKind = "view"
	KindRemote      SchemaKind = "remote"
	KindOther       SchemaKind = "other"
)

// SchemaGraphColumn is one column summary rendered inside a graph node.
type SchemaGraphColumn struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	InKey bool   `json:"in_key,omitempty"`
}

// SchemaGraphNode is one table/view/dictionary on the graph.
type SchemaGraphNode struct {
	Database     string     `json:"database"`
	Name         string     `json:"name"`
	Engine       string     `json:"engine"`
	Kind         SchemaKind `json:"kind"`
	TotalRows    uint64     `json:"total_rows"`
	TotalBytes   uint64     `json:"total_bytes"`
	SortingKey   string     `json:"sorting_key,omitempty"`
	PartitionKey string     `json:"partition_key,omitempty"`
	Comment      string     `json:"comment,omitempty"`

	// Column summary (position order), shown inside the node card. Capped at
	// maxSchemaGraphNodeColumns per node; ColumnsTruncated says when.
	Columns          []SchemaGraphColumn `json:"columns,omitempty"`
	ColumnsTruncated bool                `json:"columns_truncated,omitempty"`

	// Read during edge building, not exposed over the API.
	engineFull  string
	createQuery string
	targetDB    string
	targetTable string
}

// Key is the graph-wide unique identifier ("database.name"). Table names
// containing a literal dot are vanishingly rare; ClickHouse's own visualizer
// makes the same assumption.
func (n SchemaGraphNode) Key() string { return n.Database + "." + n.Name }

// SchemaGraphEdge is a directional dependency arrow (from → to).
type SchemaGraphEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"` // mv | dict | distributed | view
}

// SchemaGraphLoad is the INSERT load of one materialized view, aggregated
// from system.query_views_log — the heat-map overlay. All metrics are
// fetched at once; the UI picks which one to color by.
type SchemaGraphLoad struct {
	View              string `json:"view"`
	Executions        uint64 `json:"executions"`
	TotalDurationMs   uint64 `json:"total_duration_ms"`
	TotalWrittenRows  uint64 `json:"total_written_rows"`
	TotalWrittenBytes uint64 `json:"total_written_bytes"`
	TotalReadRows     uint64 `json:"total_read_rows"`
	TotalReadBytes    uint64 `json:"total_read_bytes"`
	PeakMemoryUsage   uint64 `json:"peak_memory_usage"`
}

// SchemaGraphDbCount is one database's table count — the picker's options,
// always computed over the whole instance regardless of the active filter.
type SchemaGraphDbCount struct {
	Database string `json:"database"`
	Tables   int    `json:"tables"`
}

// SchemaGraph is the full response for the schema visualizer.
type SchemaGraph struct {
	// Database is the resolved selection: the explicit filter, or the
	// auto-picked first database when the caller sent none.
	Database      string               `json:"database,omitempty"`
	Nodes         []SchemaGraphNode    `json:"nodes"`
	Edges         []SchemaGraphEdge    `json:"edges"`
	Databases     []SchemaGraphDbCount `json:"databases"`
	Load          []SchemaGraphLoad    `json:"load,omitempty"`
	PartialErrors []string             `json:"partial_errors,omitempty"`
	Note          string               `json:"note,omitempty"`
	Truncated     bool                 `json:"truncated"`
}

// maxSchemaGraphNodes caps the rendered graph; beyond this the layout is
// unreadable and the endpoint slow. The UI tells the user to filter.
const maxSchemaGraphNodes = 400

// maxSchemaGraphNodeColumns caps the column summary carried per node; the
// renderer shows the first slice and a "N more" row.
const maxSchemaGraphNodeColumns = 16

// maxSchemaGraphColumnRows caps the total system.columns rows scanned for
// one graph response (payload guard for the All-databases view).
const maxSchemaGraphColumnRows = 12000

// classifySchemaEngine maps an engine name (plus engine_full for the
// refreshable-MV distinction) to a SchemaKind.
func classifySchemaEngine(engine, engineFull string) SchemaKind {
	switch engine {
	case "MaterializedView":
		if strings.Contains(strings.ToUpper(engineFull), "REFRESH") {
			return KindRefreshable
		}
		return KindMV
	case "Dictionary":
		return KindDictionary
	case "Distributed":
		return KindDistributed
	case "View", "LiveView", "WindowView":
		return KindView
	case "S3", "URL", "Iceberg", "DeltaLake", "DataLakeCatalog", "HDFS", "AzureBlobStorage":
		return KindRemote
	}
	if strings.Contains(engine, "MergeTree") {
		return KindMergeTree
	}
	return KindOther
}

const schemaGraphSelect = `
	SELECT database, name, engine, engine_full, create_table_query,
	       coalesce(total_rows, 0), coalesce(total_bytes, 0),
	       ifNull(sorting_key, ''), ifNull(partition_key, ''), ifNull(comment, ''),
	       ifNull(target_database, ''), ifNull(target_table, ''),
	       ifNull(dependencies_database, []), ifNull(dependencies_table, [])`

const schemaGraphFromWhere = `
	FROM system.tables
	WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`

const schemaGraphOrder = `
	ORDER BY database, name`

// schemaTable is a system.tables row plus its parsed dependency arrays —
// the node carries the JSON shape, the arrays feed edge building.
type schemaTable struct {
	node         SchemaGraphNode
	dependencies [][2]string
	loadingDeps  [][2]string
}

// GetSchemaGraph builds the table/dependency graph. loadDays > 0 additionally
// aggregates system.query_views_log into the per-MV load heat-map. dbFilter
// restricts the graph to one database server-side — the default: with no
// filter the first database (alphabetical) is auto-selected, because
// unfiltered graphs don't scale past a handful of tables. includeAll lifts
// that restriction for an explicit "All databases" request (still capped).
// The databases summary always covers the whole instance, and the resolved
// selection is returned in the response.
func (c *Client) GetSchemaGraph(ctx context.Context, loadDays int, dbFilter string, includeAll bool) (*SchemaGraph, error) {
	graph := &SchemaGraph{Nodes: []SchemaGraphNode{}, Edges: []SchemaGraphEdge{}}

	// Full-instance summary: both the picker options and the auto-selection
	// source. Cheap (one GROUP BY over system.tables metadata).
	graph.Databases = c.schemaDbCounts(ctx)

	if dbFilter == "" && !includeAll {
		if len(graph.Databases) > 0 {
			dbFilter = graph.Databases[0].Database
		} else {
			// No user tables anywhere — return the empty graph.
			return graph, nil
		}
	}
	graph.Database = dbFilter

	tables, err := c.loadSchemaTables(ctx, graph, dbFilter)
	if err != nil {
		return nil, err
	}
	if len(tables) > maxSchemaGraphNodes {
		tables = tables[:maxSchemaGraphNodes]
		graph.Truncated = true
		graph.Note = fmt.Sprintf("Showing the first %d tables — use the database filter to narrow the graph.", maxSchemaGraphNodes)
	}

	byKey := make(map[string]SchemaGraphNode, len(tables))
	graph.Nodes = make([]SchemaGraphNode, 0, len(tables))
	for _, t := range tables {
		graph.Nodes = append(graph.Nodes, t.node)
		byKey[t.node.Key()] = t.node
	}

	c.attachSchemaColumns(ctx, graph, dbFilter)

	graph.Edges = buildSchemaEdges(tables, byKey)
	c.attachDictionaryEdges(ctx, graph, byKey)

	if loadDays > 0 {
		graph.Load = c.schemaViewLoad(ctx, loadDays)
	}
	return graph, nil
}

// loadSchemaTables reads system.tables, retrying with the reduced column set
// on servers that predate loading_dependencies_*.
func (c *Client) loadSchemaTables(ctx context.Context, graph *SchemaGraph, dbFilter string) ([]schemaTable, error) {
	where := schemaGraphFromWhere
	args := []any{}
	if dbFilter != "" {
		where += " AND database = ?"
		args = append(args, dbFilter)
	}
	rows, err := c.conn.Query(ctx, schemaGraphSelect+`,
	       ifNull(loading_dependencies_database, []), ifNull(loading_dependencies_table, [])`+where+schemaGraphOrder, args...)
	if err != nil {
		// Older server: unknown column (47) → retry the core set and note it.
		if chErr, _ := Classify(err); chErr == nil || chErr.Code != CHUnknownIdentifier {
			return nil, fmt.Errorf("querying system.tables: %w", err)
		}
		rows, err = c.conn.Query(ctx, schemaGraphSelect+schemaGraphFromWhere+schemaGraphOrder, args...)
		if err != nil {
			return nil, fmt.Errorf("querying system.tables: %w", err)
		}
		graph.PartialErrors = append(graph.PartialErrors,
			"loading_dependencies columns unavailable on this server — source edges come from dependents/targets only.")
		defer rows.Close()
		return scanSchemaTables(rows, false)
	}
	defer rows.Close()
	return scanSchemaTables(rows, true)
}

type schemaGraphRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close() error
}

func scanSchemaTables(rows schemaGraphRows, withLoadingDeps bool) ([]schemaTable, error) {
	defer rows.Close()
	out := make([]schemaTable, 0, 64)
	for rows.Next() {
		var node SchemaGraphNode
		var depsDb, depsTbl, loadDb, loadTbl []string
		var err error
		if withLoadingDeps {
			err = rows.Scan(&node.Database, &node.Name, &node.Engine, &node.engineFull, &node.createQuery,
				&node.TotalRows, &node.TotalBytes, &node.SortingKey, &node.PartitionKey, &node.Comment,
				&node.targetDB, &node.targetTable, &depsDb, &depsTbl, &loadDb, &loadTbl)
		} else {
			err = rows.Scan(&node.Database, &node.Name, &node.Engine, &node.engineFull, &node.createQuery,
				&node.TotalRows, &node.TotalBytes, &node.SortingKey, &node.PartitionKey, &node.Comment,
				&node.targetDB, &node.targetTable, &depsDb, &depsTbl)
		}
		if err != nil {
			return nil, fmt.Errorf("scanning system.tables row: %w", err)
		}
		t := schemaTable{node: node}
		for i := 0; i < len(depsDb) && i < len(depsTbl); i++ {
			t.dependencies = append(t.dependencies, [2]string{depsDb[i], depsTbl[i]})
		}
		for i := 0; i < len(loadDb) && i < len(loadTbl); i++ {
			t.loadingDeps = append(t.loadingDeps, [2]string{loadDb[i], loadTbl[i]})
		}
		t.node.Kind = classifySchemaEngine(t.node.Engine, t.node.engineFull)
		out = append(out, t)
	}
	return out, rows.Err()
}

// buildSchemaEdges turns the parsed arrays into deduplicated directional
// edges, mirroring ClickHouse's /schema visualizer:
//
//	loading_dependencies → source → node (the node reads FROM its sources)
//	dependencies         → node → dependent ("views that read from me")
//	target_* (MV rows)   → MV → destination table (TO target or .inner.*)
func buildSchemaEdges(tables []schemaTable, byKey map[string]SchemaGraphNode) []SchemaGraphEdge {
	seen := make(map[[3]string]bool, len(tables)*2)
	edges := make([]SchemaGraphEdge, 0, len(tables))
	add := func(from, to, kind string) {
		if from == "" || to == "" || from == to {
			return
		}
		if _, ok := byKey[from]; !ok {
			return
		}
		if _, ok := byKey[to]; !ok {
			return
		}
		key := [3]string{from, to, kind}
		if seen[key] {
			return
		}
		seen[key] = true
		edges = append(edges, SchemaGraphEdge{From: from, To: to, Kind: kind})
	}

	edgeKind := func(n SchemaGraphNode) string {
		switch n.Kind {
		case KindMV, KindRefreshable:
			return "mv"
		case KindDistributed:
			return "distributed"
		}
		return "view"
	}

	for _, t := range tables {
		key := t.node.Key()
		myKind := edgeKind(t.node)

		// Upstream sources this node reads FROM → arrow source → node.
		for _, dep := range t.loadingDeps {
			add(dep[0]+"."+dep[1], key, myKind)
		}
		// Downstream dependents ("views that read from me") → arrow node → dependent.
		for _, dep := range t.dependencies {
			depKey := dep[0] + "." + dep[1]
			kind := "view"
			if depNode, ok := byKey[depKey]; ok {
				kind = edgeKind(depNode)
			}
			add(key, depKey, kind)
		}
		// MV INSERT destination (explicit TO target or implicit .inner.*).
		if (t.node.Kind == KindMV || t.node.Kind == KindRefreshable) && t.node.targetTable != "" {
			targetDb := t.node.targetDB
			if targetDb == "" {
				targetDb = t.node.Database
			}
			add(key, targetDb+"."+t.node.targetTable, "mv")
		}
	}
	return edges
}

var (
	dictSourceTableRe  = regexp.MustCompile(`(?i)\bTABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:` + "`[^`]+`" + `|"[^"]+"|[A-Za-z0-9_]+)\.(?:` + "`[^`]+`" + `|"[^"]+"|[A-Za-z0-9_]+))`)
	distributedLocalRe = regexp.MustCompile(`(?i)\bDistributed\s*\([^,]+,\s*((?:` + "`[^`]+`" + `|"[^"]+"|[A-Za-z0-9_]+))\s*,\s*((?:` + "`[^`]+`" + `|"[^"]+"|[A-Za-z0-9_]+))`)
)

// attachDictionaryEdges adds dictionary → source-table edges (best-effort)
// and Distributed → local-table edges parsed from engine_full.
func (c *Client) attachDictionaryEdges(ctx context.Context, graph *SchemaGraph, byKey map[string]SchemaGraphNode) {
	extra := make([]SchemaGraphEdge, 0, 8)

	rows, err := c.conn.Query(ctx, "SELECT database, name, source FROM system.dictionaries WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')")
	if err != nil {
		graph.PartialErrors = append(graph.PartialErrors, "dictionaries unavailable: "+err.Error())
	} else {
		for rows.Next() {
			var db, name, source string
			if rows.Scan(&db, &name, &source) != nil {
				continue
			}
			dictKey := db + "." + name
			if _, ok := byKey[dictKey]; !ok {
				continue
			}
			if sourceTbl, ok := parseDictionarySourceTable(source); ok {
				if _, ok := byKey[sourceTbl]; ok {
					extra = append(extra, SchemaGraphEdge{From: sourceTbl, To: dictKey, Kind: "dict"})
				}
			}
		}
		rows.Close()
	}

	for _, n := range graph.Nodes {
		if n.Kind != KindDistributed {
			continue
		}
		if localTbl, ok := parseDistributedLocalTable(n.engineFull); ok {
			if _, ok := byKey[localTbl]; ok {
				extra = append(extra, SchemaGraphEdge{From: localTbl, To: n.Key(), Kind: "distributed"})
			}
		}
	}

	// Plain views: ClickHouse does not track view dependencies in
	// system.tables (only MVs), so parse qualified db.table references from
	// the view's CREATE query — same heuristic as the editor's schema cache.
	for _, n := range graph.Nodes {
		if n.Kind != KindView {
			continue
		}
		for _, ref := range parseViewSources(n.createQuery) {
			if _, ok := byKey[ref]; ok {
				extra = append(extra, SchemaGraphEdge{From: ref, To: n.Key(), Kind: "view"})
			}
		}
	}

	seen := make(map[[3]string]bool, len(graph.Edges)+len(extra))
	for _, e := range graph.Edges {
		seen[[3]string{e.From, e.To, e.Kind}] = true
	}
	for _, e := range extra {
		k := [3]string{e.From, e.To, e.Kind}
		if !seen[k] {
			seen[k] = true
			graph.Edges = append(graph.Edges, e)
		}
	}
}

// parseDictionarySourceTable extracts the backing table reference
// ("db.table", backtick/quote-unescaped) from a dictionary source DDL.
func parseDictionarySourceTable(source string) (string, bool) {
	m := dictSourceTableRe.FindStringSubmatch(source)
	if m == nil {
		return "", false
	}
	parts := strings.SplitN(m[1], ".", 2)
	return unquoteIdent(parts[0]) + "." + unquoteIdent(parts[1]), true
}

// parseDistributedLocalTable extracts the local table ("db.table") that a
// Distributed engine reads, from engine_full.
func parseDistributedLocalTable(engineFull string) (string, bool) {
	m := distributedLocalRe.FindStringSubmatch(engineFull)
	if m == nil {
		return "", false
	}
	return unquoteIdent(m[1]) + "." + unquoteIdent(m[2]), true
}

var viewSourceRe = regexp.MustCompile(`(?i)\b(?:FROM|JOIN)\s+((?:` + "`[^`]+`" + `|"[^"]+"|[A-Za-z0-9_]+)\.(?:` + "`[^`]+`" + `|"[^"]+"|[A-Za-z0-9_]+))`)

// parseViewSources extracts qualified db.table references after FROM/JOIN
// from a view's CREATE query. Best-effort: unqualified names, subquery
// aliases and table functions are ignored — a missing edge is better than
// a wrong one.
func parseViewSources(createQuery string) []string {
	matches := viewSourceRe.FindAllStringSubmatch(createQuery, -1)
	seen := make(map[string]bool, len(matches))
	var out []string
	for _, m := range matches {
		ref := unquoteIdent(strings.SplitN(m[1], ".", 2)[0]) + "." + unquoteIdent(strings.SplitN(m[1], ".", 2)[1])
		if !seen[ref] {
			seen[ref] = true
			out = append(out, ref)
		}
	}
	return out
}

func unquoteIdent(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && (s[0] == '`' || s[0] == '"') && s[len(s)-1] == s[0] {
		inner := s[1 : len(s)-1]
		if s[0] == '`' {
			return strings.ReplaceAll(inner, "``", "`")
		}
		return strings.ReplaceAll(inner, `""`, `"`)
	}
	return s
}

// attachSchemaColumns fills each node's column summary (position order,
// capped per node and overall). Best-effort: a failure leaves nodes without
// columns rather than failing the graph.
func (c *Client) attachSchemaColumns(ctx context.Context, graph *SchemaGraph, dbFilter string) {
	q := `
		SELECT database, table, name, type, (is_in_primary_key OR is_in_sorting_key) AS in_key
		FROM system.columns
		WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`
	args := []any{}
	if dbFilter != "" {
		q += " AND database = ?"
		args = append(args, dbFilter)
	}
	q += fmt.Sprintf(" ORDER BY database, table, position LIMIT %d", maxSchemaGraphColumnRows)

	rows, err := c.conn.Query(ctx, q, args...)
	if err != nil {
		graph.PartialErrors = append(graph.PartialErrors, "column summaries unavailable: "+err.Error())
		return
	}
	defer rows.Close()

	byKey := make(map[string]*SchemaGraphNode, len(graph.Nodes))
	for i := range graph.Nodes {
		byKey[graph.Nodes[i].Key()] = &graph.Nodes[i]
	}
	for rows.Next() {
		var db, table, name, typ string
		var inKey bool
		if rows.Scan(&db, &table, &name, &typ, &inKey) != nil {
			continue
		}
		node, ok := byKey[db+"."+table]
		if !ok {
			continue
		}
		if len(node.Columns) >= maxSchemaGraphNodeColumns {
			node.ColumnsTruncated = true
			continue
		}
		node.Columns = append(node.Columns, SchemaGraphColumn{Name: name, Type: typ, InKey: inKey})
	}
}

// schemaViewLoad aggregates system.query_views_log per view for the
// heat-map. Missing table / access denied → nil (the overlay just doesn't
// render).
func (c *Client) schemaViewLoad(ctx context.Context, days int) []SchemaGraphLoad {
	q := fmt.Sprintf(`
		SELECT
			view_name,
			count()                AS executions,
			sum(view_duration_ms)  AS duration_ms,
			sum(written_rows)      AS written_rows,
			sum(written_bytes)     AS written_bytes,
			sum(read_rows)         AS read_rows,
			sum(read_bytes)        AS read_bytes,
			max(peak_memory_usage) AS peak_memory
		FROM %s
		WHERE event_time >= now() - INTERVAL ? DAY
		  AND status IN ('QueryFinish', 'ExceptionWhileProcessing')
		GROUP BY view_name`, c.tableRef("query_views_log"))
	rows, err := c.conn.Query(ctx, q, days)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []SchemaGraphLoad
	for rows.Next() {
		var l SchemaGraphLoad
		// peak_memory_usage is Int64 in system.query_views_log; scan through
		// int64 so a type mismatch doesn't kill the whole overlay.
		var peak int64
		if err := rows.Scan(&l.View, &l.Executions, &l.TotalDurationMs,
			&l.TotalWrittenRows, &l.TotalWrittenBytes, &l.TotalReadRows, &l.TotalReadBytes, &peak); err != nil {
			return out
		}
		if peak > 0 {
			l.PeakMemoryUsage = uint64(peak)
		}
		if l.View != "" {
			out = append(out, l)
		}
	}
	return out
}

// schemaDbCounts lists every user database with its table count — the
// picker's options. Unfiltered by design.
func (c *Client) schemaDbCounts(ctx context.Context) []SchemaGraphDbCount {
	rows, err := c.conn.Query(ctx, `
		SELECT database, count() AS tables
		FROM system.tables
		WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
		GROUP BY database
		ORDER BY database`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []SchemaGraphDbCount{}
	for rows.Next() {
		var db string
		// count() is UInt64 — the driver scans strictly by type.
		var tables uint64
		if rows.Scan(&db, &tables) != nil {
			continue
		}
		out = append(out, SchemaGraphDbCount{Database: db, Tables: int(tables)})
	}
	return out
}
