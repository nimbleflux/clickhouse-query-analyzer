import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { sql, SQLNamespace } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { Play, Database, ChevronRight, ChevronDown, Loader2, ExternalLink, Table2, Square, Copy, Check, RefreshCw } from "lucide-react";
import { executeQuery, fetchSchema } from "../api/client";
import type { QueryResult, SchemaInfo } from "../api/types";
import { formatNumber } from "../utils";

const STORAGE_KEY = "ch-query-editor-sql";

function getSavedSQL(): string {
  try { return localStorage.getItem(STORAGE_KEY) || "SELECT "; } catch { return "SELECT "; }
}

function CellValue({ val }: { val: any }) {
  const [copied, setCopied] = useState(false);

  const display =
    val === null || val === undefined
      ? "NULL"
      : typeof val === "object"
        ? JSON.stringify(val)
        : String(val);

  const copy = () => {
    const text =
      val === null || val === undefined
        ? ""
        : typeof val === "object"
          ? JSON.stringify(val, null, 2)
          : String(val);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isNull = val === null || val === undefined;
  const isObj = typeof val === "object" && !isNull;

  return (
    <span className="group/cell relative inline-flex max-w-full items-center">
      <span
        className={`truncate ${isNull ? "italic text-[var(--color-text-secondary)]" : isObj ? "text-[var(--color-accent)]" : ""}`}
        title={isObj ? JSON.stringify(val, null, 2) : display}
      >
        {display}
      </span>
      <button
        onClick={copy}
        className="ml-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--color-bg-tertiary)] group-hover/cell:opacity-100"
        title="Copy"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-400" />
        ) : (
          <Copy className="h-3 w-3 text-[var(--color-text-secondary)]" />
        )}
      </button>
    </span>
  );
}

export function QueryEditor() {
  const navigate = useNavigate();
  const [sqlText, setSQLText] = useState(getSavedSQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const editorRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const loadSchema = useCallback(() => {
    setSchemaLoading(true);
    fetchSchema().then(setSchema).catch(() => {}).finally(() => setSchemaLoading(false));
  }, []);

  useEffect(() => { loadSchema(); }, [loadSchema]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, sqlText); } catch {}
  }, [sqlText]);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startTimeRef.current) {
      setElapsed(Date.now() - startTimeRef.current);
    }
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const runQuery = useCallback(async () => {
    if (!sqlText.trim()) return;
    setRunning(true);
    setError("");
    setResult(null);
    abortRef.current = new AbortController();
    startTimer();
    try {
      const r = await executeQuery(sqlText, 5000);
      setResult(r);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      stopTimer();
      setRunning(false);
      abortRef.current = null;
    }
  }, [sqlText, startTimer, stopTimer]);

  const cancelQuery = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      stopTimer();
      setRunning(false);
    }
  }, [stopTimer]);

  const formatElapsed = (ms: number) => {
    if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const min = Math.floor(ms / 60000);
    const sec = ((ms % 60000) / 1000).toFixed(0);
    return `${min}m ${sec}s`;
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
  }, [runQuery]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const insertAtCursor = (text: string) => {
    const view = editorRef.current?.view;
    if (view) {
      const cursor = view.state.selection.main.head;
      view.dispatch({
        changes: { from: cursor, insert: text },
        selection: { anchor: cursor + text.length },
      });
      view.focus();
    } else {
      setSQLText((prev) => prev + text);
    }
  };

  const buildSQLNamespace = (): SQLNamespace => {
    if (!schema) return {};
    const ns: SQLNamespace = {};
    for (const db of schema.databases) {
      const tables: { [table: string]: string[] } = {};
      for (const t of db.tables || []) {
        tables[t.name] = t.columns.map((c) => c.name);
      }
      ns[db.name] = tables;
    }
    return ns;
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-y-auto overflow-x-hidden">
        <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2">
          <div className="flex items-center justify-between gap-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
            <div className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" />
              Schema
            </div>
            <button
              onClick={loadSchema}
              disabled={schemaLoading}
              className="rounded p-1 hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
              title="Reload schema"
            >
              <RefreshCw className={`h-3 w-3 ${schemaLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="p-1">
          {schema ? schema.databases.map((db) => (
            <div key={db.name}>
              <button
                onClick={() => toggleExpand(`db:${db.name}`)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
              >
                {expanded.has(`db:${db.name}`) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <span className="truncate">{db.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-secondary)]">{(db.tables || []).length}</span>
              </button>
              {expanded.has(`db:${db.name}`) && (db.tables || []).map((t) => (
                <div key={t.name} className="group relative">
                  <div className="flex items-center">
                    <button
                      onClick={() => toggleExpand(`tbl:${db.name}.${t.name}`)}
                      className="flex flex-1 min-w-0 items-center gap-1 rounded px-2 py-1 pl-5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
                    >
                      {expanded.has(`tbl:${db.name}.${t.name}`) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <Table2 className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" />
                      <span className="truncate">{t.name}</span>
                      {t.row_count > 0 && <span className="ml-1 shrink-0 text-[10px] text-[var(--color-text-secondary)]">({formatNumber(t.row_count)})</span>}
                    </button>
                    <button
                      onClick={() => setSQLText(`SELECT * FROM ${db.name}.${t.name}`)}
                      className="mr-1 shrink-0 rounded p-1 text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"
                      title="SELECT * FROM"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  {expanded.has(`tbl:${db.name}.${t.name}`) && (
                    <div className="pl-10">
                      {t.columns.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => insertAtCursor(c.name)}
                          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0 text-[9px] opacity-60">{c.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )) : (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-[var(--color-text-secondary)]">
              {schemaLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {schemaLoading ? "Loading schema..." : "Failed to load schema"}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5">
            {running ? (
              <button
                onClick={cancelQuery}
                className="flex items-center gap-1.5 rounded bg-[var(--color-error)] px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            ) : (
              <button
                onClick={runQuery}
                disabled={!sqlText.trim()}
                className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
            )}
            <span className="text-[10px] text-[var(--color-text-secondary)]">Ctrl+Enter</span>
            {running && (
              <span className="ml-2 flex items-center gap-1.5 text-xs font-mono text-[var(--color-accent)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {formatElapsed(elapsed)}
              </span>
            )}
            {result && !running && (
              <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                {formatNumber(result.row_count)} rows in {formatElapsed(result.timing_ms)}
              </span>
            )}
          </div>
          <div className="h-48">
            <CodeMirror
              ref={editorRef}
              value={sqlText}
              onChange={setSQLText}
              theme={oneDark}
              extensions={[sql({ schema: buildSQLNamespace() })]}
              basicSetup={{ lineNumbers: true, foldGutter: false }}
              className="h-full text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:!font-mono [&_.cm-scroller]:text-[13px]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[var(--color-bg-primary)]">
          {error && (
            <div className="m-3 rounded-lg border border-[var(--color-error)] bg-red-900/20 px-4 py-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}

          {result && (
            <div className="p-3">
              {result.query_id && (
                <div className="mb-2 flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/query/${result.query_id}`)}
                    className="flex items-center gap-1 rounded border border-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-blue-900/20"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View Analysis
                  </button>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
                    {result.query_id}
                    <button
                      onClick={() => { navigator.clipboard.writeText(result.query_id); }}
                      className="rounded p-0.5 hover:bg-[var(--color-bg-tertiary)]"
                      title="Copy Query ID"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              )}
              {result.columns.length > 0 ? (
                <div className="overflow-auto rounded-lg border border-[var(--color-border)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                        {result.columns.map((c) => (
                          <th key={c.name} className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] whitespace-nowrap">
                            <div>{c.name}</div>
                            <div className="text-[9px] font-normal opacity-60">{c.type}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-secondary)]">
                          {result.columns.map((c) => {
                            const val = row[c.name];
                            return (
                              <td key={c.name} className="max-w-sm px-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                                <CellValue val={val} />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-[var(--color-text-secondary)]">Query executed successfully. No results returned.</div>
              )}
            </div>
          )}

          {!result && !error && (
            <div className="flex flex-col items-center gap-2 py-16 text-[var(--color-text-secondary)]">
              <Play className="h-8 w-8 opacity-30" />
              <p className="text-sm">Write a query and press Run</p>
              <p className="text-xs opacity-60">Results will appear here. Click "View Analysis" to see profiling data.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
