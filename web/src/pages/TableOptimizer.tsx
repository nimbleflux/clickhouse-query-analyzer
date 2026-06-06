import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { Plug, Loader2, ChevronDown, ChevronRight, Copy, ArrowDown, ArrowUp, Play, StopCircle, Zap, Send } from "lucide-react";
import { fetchDatabases, fetchTables, fetchTableAnalysis, streamBulkAnalysis } from "../api/client";
import { getCachedDatabases, getCachedSchemaData, setCachedDatabases, updateSchemaDb } from "../api/schema-cache";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import type { TableAnalysis, Recommendation, BulkEvent, BulkProgress } from "../api/types";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { TableSummary } from "./optimizer/TableSummary";
import { RecommendationCards } from "./optimizer/RecommendationCards";
import { countBySeverity, severityScore, type AnalysisMode, type SortField } from "./optimizer/types";
import { sendToEditor } from "@/lib/send-to-editor";

export function TableOptimizer({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
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
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
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

  useEffect(() => {
    if (urlDb && urlTable && connected) {
      runAnalysis();
    }
  }, [urlDb, urlTable, connected]);

  const confirmStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStopConfirmOpen(false);
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

  const allRecs: Recommendation[] = bulkResults.flatMap((r) => r.recommendations || []);
  const singleRecs = singleResult?.recommendations || [];
  const activeRecs = mode === "single" ? singleRecs : allRecs;

  const copyAllDDL = () => {
    const ddls = activeRecs.filter((r) => r.ddl).map((r) => r.ddl);
    copy(ddls.join("\n\n"), "DDL copied!");
  };

  const sendAllDDLToEditor = () => {
    const ddls = activeRecs.filter((r) => r.ddl).map((r) => r.ddl);
    if (ddls.length === 0) return;
    sendToEditor(navigate, ddls.join("\n\n"), { origin: "optimizer" });
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
      <PageContainer>
        <EmptyState
          icon={Plug}
          iconSize="lg"
          title="Connect to ClickHouse"
          description="Enter your connection details in the top bar to start optimizing tables."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <ConfirmDialog
        open={stopConfirmOpen}
        title="Stop analysis?"
        message="In-progress tables will finish, but no further tables will be analyzed."
        confirmLabel="Stop"
        confirmVariant="danger"
        onConfirm={confirmStop}
        onCancel={() => setStopConfirmOpen(false)}
      />

      <PageHeader
        heading="h1"
        title="Table Optimizer"
        description="Analyze tables for ClickHouse optimization opportunities."
        actions={
          activeRecs.length > 0 ? (
            <>
              <Button variant="secondary" size="md" onClick={sendAllDDLToEditor} title="Open all DDL in SQL Editor">
                <Send className="h-3.5 w-3.5" />
                Open in Editor
              </Button>
              <Button variant="primary" size="md" onClick={copyAllDDL}>
                <Copy className="h-3.5 w-3.5" />
                Copy All DDL
              </Button>
            </>
          ) : undefined
        }
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
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
            <Select
              value={selectedDb}
              onChange={(e) => { setSelectedDb(e.target.value); setSelectedTable(""); }}
            >
              <option value="">Select database…</option>
              {databases.map((db) => <option key={db} value={db}>{db}</option>)}
            </Select>
          )}

          {mode === "single" && (
            <Select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)}>
              <option value="">Select table…</option>
              {tables.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </Select>
          )}

          <Button
            variant="primary"
            size="md"
            onClick={runAnalysis}
            disabled={loading || (mode === "single" && (!selectedDb || !selectedTable)) || (mode === "database" && !selectedDb)}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Analyze
          </Button>

          {loading && mode !== "single" && (
            <Button variant="destructive" size="md" onClick={() => setStopConfirmOpen(true)}>
              <StopCircle className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
        </div>
      </Card>

      {bulkProgress && loading && (
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <span>Analyzing {bulkProgress.database}.{bulkProgress.table}…</span>
            <span>{bulkProgress.current}/{bulkProgress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-elevated)]">
            <div
              className="h-2 rounded-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            />
          </div>
        </Card>
      )}

      {bulkDone && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          Analysis complete: <span className="text-[var(--color-text-primary)]">{bulkDone.analyzed}</span> analyzed,{" "}
          <span className="text-[var(--color-text-primary)]">{bulkDone.skipped}</span> skipped,{" "}
          <span className={bulkDone.errors > 0 ? "text-[var(--color-error)]" : "text-[var(--color-text-primary)]"}>{bulkDone.errors}</span> errors
        </div>
      )}

      {error && <ErrorState error={error} onRetry={runAnalysis} />}

      {loading && mode === "single" && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-accent)]" />
          <span className="ml-3 text-sm text-[var(--color-text-secondary)]">Analyzing {selectedDb}.{selectedTable}…</span>
        </div>
      )}

      {singleResult && !loading && (
        <div>
          <TableSummary analysis={singleResult} />
          <RecommendationCards recommendations={singleResult.recommendations || []} />
        </div>
      )}

      {sortedResults.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
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
                const counts = countBySeverity(recs);
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--surface-hover)] ${r.error ? "opacity-60" : ""}`}
                      onClick={() => setExpandedTable(isExpanded ? null : key)}
                    >
                      <td className="px-3 py-2 font-medium">
                        <span className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          <span className="text-[var(--color-text-secondary)]">{r.database}.</span>{r.table}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">{r.engine}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{r.total_rows}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-secondary)]">{r.total_bytes}</td>
                      <td className="px-3 py-2 text-right">{recs.length}</td>
                      <td className="px-3 py-2 text-center">
                        {recs.length > 0 ? (
                          <div className="flex items-center justify-center gap-1">
                            {counts.high > 0 && <Badge variant="error">{counts.high}</Badge>}
                            {counts.medium > 0 && <Badge variant="warning">{counts.medium}</Badge>}
                            {counts.low > 0 && <Badge variant="default">{counts.low}</Badge>}
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
                        <td colSpan={6} className="border-b border-[var(--color-border)] bg-[var(--surface-base)] px-6 py-4">
                          {r.error ? (
                            <p className="text-sm text-[var(--color-error)]">{r.error}</p>
                          ) : (
                            <>
                              <TableSummary analysis={r} compact />
                              <RecommendationCards recommendations={recs} />
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

      {!loading && !singleResult && bulkResults.length === 0 && !error && (
        <EmptyState
          icon={Zap}
          title="Ready to analyze"
          description="Pick a table, database, or all databases above, then click Analyze."
        />
      )}
    </PageContainer>
  );
}
