package clickhouse

import (
	"testing"
)

func TestClassifySchemaEngine(t *testing.T) {
	tests := []struct {
		engine     string
		engineFull string
		want       SchemaKind
	}{
		{"MergeTree", "MergeTree ORDER BY x", KindMergeTree},
		{"ReplacingMergeTree", "ReplacingMergeTree(ver) ORDER BY x", KindMergeTree},
		{"MaterializedView", "MaterializedView TO db.target AS SELECT ...", KindMV},
		{"MaterializedView", "MaterializedView REFRESH EVERY 1 HOUR AS SELECT ...", KindRefreshable},
		{"Dictionary", "Dictionary", KindDictionary},
		{"Distributed", "Distributed(dev_cluster, db, table)", KindDistributed},
		{"View", "View AS SELECT 1", KindView},
		{"LiveView", "LiveView AS SELECT 1", KindView},
		{"WindowView", "WindowView()", KindView},
		{"S3", "S3('https://x/y')", KindRemote},
		{"URL", "URL('http://x')", KindRemote},
		{"Iceberg", "Iceberg(...)", KindRemote},
		{"Memory", "Memory", KindOther},
		{"Join", "Join(ANY, LEFT, k1, k2, ...)", KindOther},
		{"File", "File(TSV)", KindOther},
	}
	for _, tt := range tests {
		if got := classifySchemaEngine(tt.engine, tt.engineFull); got != tt.want {
			t.Errorf("classifySchemaEngine(%q, %q) = %q, want %q", tt.engine, tt.engineFull, got, tt.want)
		}
	}
}

func graphFixture() ([]schemaTable, map[string]SchemaGraphNode) {
	mk := func(db, name, engine string, deps, loading [][2]string, targetDB, targetTable string) schemaTable {
		t := schemaTable{node: SchemaGraphNode{Database: db, Name: name, Engine: engine}}
		t.node.Kind = classifySchemaEngine(engine, engine)
		t.dependencies = deps
		t.loadingDeps = loading
		t.node.targetDB = targetDB
		t.node.targetTable = targetTable
		return t
	}
	tables := []schemaTable{
		// The classic MV chain: events --(mv)--> events_daily --(mv)--> events_rollup
		mk("analytics", "events", "MergeTree", [][2]string{{"analytics", "events_daily"}}, nil, "", ""),
		mk("analytics", "events_daily", "MaterializedView", [][2]string{{"analytics", "events_rollup"}}, [][2]string{{"analytics", "events"}}, "analytics", "events_daily_target"),
		mk("analytics", "events_daily_target", "MergeTree", nil, nil, "", ""),
		mk("analytics", "events_rollup", "MaterializedView", nil, [][2]string{{"analytics", "events_daily"}}, "", ""),
		// A remote table and a plain one with no edges.
		mk("raw", "s3_events", "S3", nil, nil, "", ""),
		mk("raw", "plain", "Memory", nil, nil, "", ""),
	}
	byKey := make(map[string]SchemaGraphNode, len(tables))
	for _, tbl := range tables {
		byKey[tbl.node.Key()] = tbl.node
	}
	return tables, byKey
}

func TestBuildSchemaEdges(t *testing.T) {
	tables, byKey := graphFixture()
	edges := buildSchemaEdges(tables, byKey)

	type edge struct{ from, to, kind string }
	want := map[edge]bool{
		// events → events_daily (source → MV, via the MV's loading_deps)
		{"analytics.events", "analytics.events_daily", "mv"}: true,
		// events_daily → events_rollup (source → MV)
		{"analytics.events_daily", "analytics.events_rollup", "mv"}: true,
		// events → events_daily via dependencies (deduped with the above)
		// events_daily → events_daily_target (MV → TO target)
		{"analytics.events_daily", "analytics.events_daily_target", "mv"}: true,
		// events_daily → events_rollup via dependencies (deduped)
	}
	got := map[edge]bool{}
	for _, e := range edges {
		got[edge{e.From, e.To, e.Kind}] = true
	}
	for e := range want {
		if !got[e] {
			t.Errorf("missing edge %+v", e)
		}
	}
	for e := range got {
		if !want[e] {
			t.Errorf("unexpected edge %+v", e)
		}
	}
	if len(edges) != 3 {
		t.Errorf("expected exactly 3 deduplicated edges, got %d: %+v", len(edges), edges)
	}
}

func TestBuildSchemaEdgesSkipsMissingAndSelfEdges(t *testing.T) {
	tbl := schemaTable{
		node:         SchemaGraphNode{Database: "db", Name: "t", Engine: "MergeTree"},
		dependencies: [][2]string{{"db", "t"}, {"db", "ghost"}, {"other", "t"}},
	}
	tbl.node.Kind = KindMergeTree
	byKey := map[string]SchemaGraphNode{"db.t": tbl.node}
	edges := buildSchemaEdges([]schemaTable{tbl}, byKey)
	// db.t → db.t is a self edge (skipped), db.ghost and other.t are missing nodes (skipped).
	if len(edges) != 0 {
		t.Fatalf("expected no edges, got %+v", edges)
	}
}

func TestParseDictionarySourceTable(t *testing.T) {
	tests := []struct {
		source string
		want   string
		ok     bool
	}{
		{`CLICKHOUSE(USER 'u' PASSWORD 'p' TABLE db.events)`, "db.events", true},
		{"CLICKHOUSE(TABLE `my db`.`my table`)", "my db.my table", true},
		{"CLICKHOUSE(TABLE events)", "", false}, // no db qualifier → not parseable
		{"POSTGRESQL(port 5432 ...)", "", false},
	}
	for _, tt := range tests {
		got, ok := parseDictionarySourceTable(tt.source)
		if ok != tt.ok || (ok && got != tt.want) {
			t.Errorf("parseDictionarySourceTable(%q) = %q, %v; want %q, %v", tt.source, got, ok, tt.want, tt.ok)
		}
	}
}

func TestParseDistributedLocalTable(t *testing.T) {
	tests := []struct {
		engineFull string
		want       string
		ok         bool
	}{
		{"Distributed(dev_cluster, analytics, events, rand())", "analytics.events", true},
		{"Distributed(cluster, `my db`, `my table`, rand())", "my db.my table", true},
		{"Distributed('cluster', db, t)", "db.t", true},
		{"MergeTree ORDER BY x", "", false},
	}
	for _, tt := range tests {
		got, ok := parseDistributedLocalTable(tt.engineFull)
		if ok != tt.ok || (ok && got != tt.want) {
			t.Errorf("parseDistributedLocalTable(%q) = %q, %v; want %q, %v", tt.engineFull, got, ok, tt.want, tt.ok)
		}
	}
}
