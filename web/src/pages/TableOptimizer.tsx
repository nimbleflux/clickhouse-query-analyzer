import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Plug, Loader2, ChevronDown, ChevronRight, Copy, Check, AlertTriangle, Zap, ArrowDown, ArrowUp, Play, StopCircle } from "lucide-react";
import { fetchDatabases, fetchTables, fetchTableAnalysis, streamBulkAnalysis } from "../api/client";
import { getCachedDatabases, getCachedSchemaData, setCachedDatabases, updateSchemaDb } from "../api/schema-cache";
import { formatBytes, formatNumber } from "../utils";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import type { TableAnalysis, Recommendation, BulkEvent, BulkProgress } from "../api/types";

type AnalysisMode = "single" | "database" | "all";
type SortField = "table" | "rows" | "bytes" | "recs" | "severity";

const CATEGORY_LABELS: Record<string, string> = {
  data_type: "Data Type",
  order_by: "ORDER BY",
  partition_by: "PARTITION BY",
  index: "Skipping Index",
  codec: "Codec",
  health: "Table Health",
};

const CATEGORY_ORDER = ["data_type", "order_by", "partition_by", "index", "codec", "health"];

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function severityColor(s: string) {
  if (s === "high") return "bg-[var(--color-error)]/10 text-[var(--color-error)]";
  if (s === "medium") return "bg-[var(--color-warning)]/10 text-[var(--color-warning)]";
  return "bg-[var(--color-accent)]/10 text-[var(--color-accent)]";
}

function severityScore(recs: Recommendation[]) {
  return recs.reduce((sum, r) => sum + (SEVERITY_RANK[r.severity] || 0), 0);
}

export function TableOptimizer({ connected }: { connected: boolean }) {
  const { db: urlDb, table: urlTable } = useParams<{ db?: string; table?: string }>();
  const [searchParams] = useSearchParams();
  const queryDb = searchParams.get("db");

  const [databases, setDatabases] = useState<string[]>(getCachedDatabases());
  const [selectedDb, setSelectedDb] = useState(urlDb || queryDb || "");
  const [selectedTable, setSelectedTable] = useState(urlTable || "");
  const [tables, setTables] = useState<{ name: string; engine: string; row_count: number }[]>([]);
  const [mode, setMode] = useState<AnalysisMode>(urlDb && urlTable ? "single" : "single");
  const copy = useCopyToClipboard();

  const [singleResult, setSingleResult] = useState<TableAnalysis | null>(null);
  const [bulkResults, setBulkResults] = useState<TableAnalysis[]>([]);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkDone, setBulkDone] = useState<{ analyzed: number; skipped: number; errors: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!connected) return;
    const cached = getCachedDatabases();
    if (cached.length > 0) {
      setDatabases(cached);
      return;
    }
    fetchDatabases().then((d) => {
      setDatabases(d.databases);
      setCachedDatabases(d.databases);
    }).catch(() => {});
  }, [connected]);

  useEffect(() => {
    if (!selectedDb) { setTables([]); return; }
    const cached = getCachedSchemaData()[selectedDb];
    if (cached?.tables) {
      setTables(cached.tables);
      return;
    }
    fetchTables(selectedDb).then((d) => {
      setTables(d.tables || []);
      updateSchemaDb(selectedDb, { tables: d.tables || [] });
    }).catch(() => {});
  }, [selectedDb]);

  useEffect(() => {
    if (urlDb && urlTable && connected) {
      runAnalysis();
    }
  }, [urlDb, urlTable, connected]);

  const runAnalysis = useCallback(async () => {
    if (mode === "single") {
      if (!selectedDb || !selectedTable) return;
      setLoading(true);
      setError("");
      setSingleResult(null);
      try {
        const result = await fetchTableAnalysis(selectedDb, selectedTable);
        setSingleResult(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(true);
      setError("");
      setBulkResults([]);
      setBulkProgress(null);
      setBulkDone(null);
      setExpandedTable(null);

      const db = mode === "database" ? selectedDb : "";
      const ctrl = streamBulkAnalysis(
        mode === "all" ? "all" : "database",
        db,
        undefined,
        (evt: BulkEvent) => {
          if (evt.type === "progress" && evt.progress) {
            setBulkProgress(evt.progress);
          } else if (evt.type === "result" && evt.result) {
            setBulkResults((prev) => [...prev, evt.result!]);
          } else if (evt.type === "done" && evt.done) {
            setBulkDone(evt.done);
            setLoading(false);
          }
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        },
      );
      abortRef.current = ctrl;
    }
  }, [mode, selectedDb, selectedTable]);

  const stopAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const sortedResults = [...bulkResults].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    const aRecs = a.recommendations?.length || 0;
    const bRecs = b.recommendations?.length || 0;
    switch (sortField) {
      case "table": return dir * a.table.localeCompare(b.table);
      case "rows": return dir * ((a.total_rows || 0) - (b.total_rows || 0));
      case "bytes": return dir * ((a.total_bytes || 0) - (b.total_bytes || 0));
      case "recs": return dir * (aRecs - bRecs);
      case "severity": return dir * (severityScore(a.recommendations || []) - severityScore(b.recommendations || []));
      default: return 0;
    }
  });

  const allRecs = bulkResults.flatMap((r) => r.recommendations || []);
  const singleRecs = singleResult?.recommendations || [];
  const activeRecs = mode === "single" ? singleRecs : allRecs;
  const groupedRecs = groupByCategory(activeRecs);

  const copyAllDDL = () => {
    const ddls = activeRecs.filter((r) => r.ddl).map((r) => r.ddl);
    copy(ddls.join("\n\n"), "DDL copied!");
  };

  const renderSortHeader = (field: SortField, label: string) => (
    <button
      onClick={() => { if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortField(field); setSortDir("desc"); } }}
      className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
    >
      {label}
      {sortField === field && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-4 py-24">
        <Plug className="h-12 w-12 text-[var(--color-text-secondary)]" />
        <p className="text-lg font-medium text-[var(--color-text-secondary)]">Connect to ClickHouse</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Enter your connection details above to start optimizing tables.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-[var(--color-text-secondary)]" />
          <h1 className="text-2xl font-bold">Table Optimizer</h1>
        </div>
        {activeRecs.length > 0 && (
          <button onClick={copyAllDDL} className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)]">
            <Copy className="h-3.5 w-3.5" /> Copy All DDL
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
        <div className="flex items-center gap-3 py-1.5">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="radio" checked={mode === "single"} onChange={() => setMode("single")} className="accent-[var(--color-accent)]" />
            Single table
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="radio" checked={mode === "database"} onChange={() => setMode("database")} className="accent-[var(--color-accent)]" />
            Database
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} className="accent-[var(--color-accent)]" />
            All databases
          </label>
        </div>

        {mode !== "all" && (
          <select
            value={selectedDb}
            onChange={(e) => { setSelectedDb(e.target.value); setSelectedTable(""); }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)]"
          >
            <option value="">Select database...</option>
            {databases.map((db) => <option key={db} value={db}>{db}</option>)}
          </select>
        )}

        {mode === "single" && (
          <select
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)]"
          >
            <option value="">Select table...</option>
            {tables.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        )}

        <button
          onClick={runAnalysis}
          disabled={loading || (mode === "single" && (!selectedDb || !selectedTable)) || (mode === "database" && !selectedDb)}
          className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Analyze
        </button>

        {loading && mode !== "single" && (
          <button onClick={stopAnalysis} className="flex items-center gap-1.5 rounded bg-[var(--color-error)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
            <StopCircle className="h-3.5 w-3.5" /> Stop
          </button>
        )}
      </div>

      {/* Progress */}
      {bulkProgress && loading && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <span>Analyzing {bulkProgress.database}.{bulkProgress.table}...</span>
            <span>{bulkProgress.current}/{bulkProgress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-bg-tertiary)]">
            <div
              className="h-2 rounded-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {bulkDone && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-secondary)]">
          Analysis complete: {bulkDone.analyzed} analyzed, {bulkDone.skipped} skipped, {bulkDone.errors} errors
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 p-3 text-sm text-[var(--color-error)]">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Loading spinner for single */}
      {loading && mode === "single" && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent)]" />
          <span className="ml-3 text-sm text-[var(--color-text-secondary)]">Analyzing {selectedDb}.{selectedTable}...</span>
        </div>
      )}

      {/* Single table result */}
      {singleResult && !loading && (
        <div>
          <TableSummary analysis={singleResult} />
          <RecommendationCards recommendations={singleResult.recommendations || []} grouped={groupedRecs} />
        </div>
      )}

      {/* Bulk results table */}
      {sortedResults.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="px-3 py-2 text-left">{renderSortHeader("table", "Table")}</th>
                <th className="px-3 py-2 text-left">Engine</th>
                <th className="px-3 py-2 text-right">{renderSortHeader("rows", "Rows")}</th>
                <th className="px-3 py-2 text-right">{renderSortHeader("bytes", "Size")}</th>
                <th className="px-3 py-2 text-right">{renderSortHeader("recs", "Recs")}</th>
                <th className="px-3 py-2 text-center">{renderSortHeader("severity", "Severity")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((r) => {
                const key = `${r.database}.${r.table}`;
                const isExpanded = expandedTable === key;
                const recs = r.recommendations || [];
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] ${r.error ? "opacity-60" : ""}`}
                      onClick={() => setExpandedTable(isExpanded ? null : key)}
                    >
                      <td className="px-3 py-2 font-medium">
                        <span className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          <span className="text-[var(--color-text-secondary)]">{r.database}.</span>{r.table}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{r.engine}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{formatNumber(r.total_rows)}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{formatBytes(r.total_bytes)}</td>
                      <td className="px-3 py-2 text-right">{recs.length}</td>
                      <td className="px-3 py-2 text-center">
                        {recs.length > 0 ? (
                          <div className="flex items-center justify-center gap-1">
                            {countBySeverity(recs).high > 0 && <span className="rounded bg-[var(--color-error)]/10 px-1.5 py-0.5 text-[var(--color-error)]">{countBySeverity(recs).high}</span>}
                            {countBySeverity(recs).medium > 0 && <span className="rounded bg-[var(--color-warning)]/10 px-1.5 py-0.5 text-[var(--color-warning)]">{countBySeverity(recs).medium}</span>}
                            {countBySeverity(recs).low > 0 && <span className="rounded bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[var(--color-accent)]">{countBySeverity(recs).low}</span>}
                          </div>
                        ) : r.error ? (
                          <span className="text-[var(--color-error)]">Error</span>
                        ) : (
                          <span className="text-[var(--color-success)]">OK</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-6 py-4">
                          {r.error ? (
                            <p className="text-sm text-[var(--color-error)]">{r.error}</p>
                          ) : (
                            <>
                              <TableSummary analysis={r} compact />
                              <RecommendationCards recommendations={recs} grouped={groupByCategory(recs)} />
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TableSummary({ analysis, compact }: { analysis: TableAnalysis; compact?: boolean }) {
  const items = [
    { label: "Engine", value: analysis.engine },
    { label: "Rows", value: formatNumber(analysis.total_rows) },
    { label: "Size", value: formatBytes(analysis.total_bytes) },
    { label: "Parts", value: String(analysis.parts?.length || 0) },
    { label: "ORDER BY", value: analysis.order_by_key || "(none)" },
    { label: "PARTITION BY", value: analysis.partition_key || "(none)" },
  ];

  if (compact) {
    return (
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {items.map((i) => (
          <span key={i.label}><span className="font-medium text-[var(--color-text-primary)]">{i.label}:</span> {i.value}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <div className="text-xs text-[var(--color-text-secondary)]">{i.label}</div>
          <div className="mt-1 text-sm font-medium truncate" title={i.value}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function RecommendationCards({ recommendations, grouped }: { recommendations: Recommendation[]; grouped: Record<string, Recommendation[]> }) {
  if (recommendations.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-800 bg-green-900/20 p-4 text-sm text-green-400">
        <Zap className="h-4 w-4" /> No optimizations needed — table looks good!
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map((cat) => {
        const recs = grouped[cat];
        if (!recs || recs.length === 0) return null;
        return (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              {CATEGORY_LABELS[cat] || cat}
            </h3>
            <div className="space-y-2">
              {recs.map((r, i) => <RecCard key={i} rec={r} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function confidenceColor(c: string) {
  if (c === "high") return "bg-[var(--color-success)]/10 text-[var(--color-success)]";
  if (c === "medium") return "bg-[var(--color-warning)]/10 text-[var(--color-warning)]";
  return "bg-[var(--color-text-secondary)]/10 text-[var(--color-text-secondary)]";
}

const CONFIDENCE_TOOLTIPS: Record<string, string> = {
  high: "Based on sufficient data — reliable recommendation",
  medium: "Based on moderate data — consider verifying before applying",
  low: "Based on limited data — verify with a full scan or larger sample before applying",
};

function RecCard({ rec }: { rec: Recommendation }) {
  const [copied, setCopied] = useState(false);

  const copyDDL = () => {
    if (!rec.ddl) return;
    navigator.clipboard.writeText(rec.ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${severityColor(rec.severity)}`}>
              {rec.severity}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${confidenceColor(rec.confidence)}`}
              title={CONFIDENCE_TOOLTIPS[rec.confidence] || ""}
            >
              {rec.confidence} confidence
            </span>
            <span className="text-sm font-medium">{rec.title}</span>
            {rec.requires_recreate && (
              <span className="flex items-center gap-1 rounded bg-[var(--color-warning)]/10 px-1.5 py-0.5 text-xs text-[var(--color-warning)]">
                <AlertTriangle className="h-3 w-3" /> recreate
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{rec.description}</p>
          {rec.current && rec.suggested && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <code className="rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">{rec.current}</code>
              <span className="text-[var(--color-text-secondary)]">&rarr;</span>
              <code className="rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-[var(--color-accent)]">{rec.suggested}</code>
            </div>
          )}
          {rec.impact && (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)] italic">{rec.impact}</p>
          )}
          {rec.ddl && (
            <div className="mt-2 flex items-center gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-[var(--color-bg-primary)] p-2 text-xs text-[var(--color-text-secondary)]">{rec.ddl}</pre>
              <button onClick={copyDDL} className="shrink-0 rounded p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title="Copy DDL">
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function groupByCategory(recs: Recommendation[]): Record<string, Recommendation[]> {
  const result: Record<string, Recommendation[]> = {};
  for (const r of recs) {
    const cat = r.category || "other";
    if (!result[cat]) result[cat] = [];
    result[cat].push(r);
  }
  for (const k of Object.keys(result)) {
    result[k].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  }
  return result;
}

function countBySeverity(recs: Recommendation[]) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of recs) {
    if (r.severity in counts) counts[r.severity as keyof typeof counts]++;
  }
  return counts;
}
