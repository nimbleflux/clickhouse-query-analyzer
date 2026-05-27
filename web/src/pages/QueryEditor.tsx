import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { sql, SQLNamespace } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { acceptCompletion } from "@codemirror/autocomplete";
import { format as sqlFormat } from "sql-formatter";
import { Play, Database, ChevronRight, ChevronDown, Loader2, ExternalLink, Table2, Square, Copy, Check, RefreshCw, Settings2, ChevronLeft, ChevronRightIcon, Plus, X, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { executeQuery, fetchDatabases, fetchTables, fetchColumns } from "../api/client";
import type { QueryResult } from "../api/types";
import { formatNumber } from "../utils";
import { useTheme } from "../api/theme";
import {
  getCachedDatabases, getCachedSchemaData, setCachedDatabases, setCachedSchemaData,
  updateSchemaDb, invalidateSchema, isSchemaStale, extractDatabaseNames,
} from "../api/schema-cache";
import type { SchemaData } from "../api/schema-cache";

interface EditorTab {
  id: string;
  name: string;
  sql: string;
  results: QueryResult[];
  errors: string[];
  running: boolean;
  resultPage: number;
}

const TABS_KEY = "ch-editor-tabs";
const ACTIVE_TAB_KEY = "ch-editor-active-tab";
const PAGE_SIZE_KEY = "ch-editor-page-size";
const SETTINGS_KEY = "ch-editor-settings";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadTabs(): EditorTab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [{ id: uid(), name: "Query 1", sql: "SELECT ", results: [], errors: [], running: false, resultPage: 0 }];
}

function saveTabs(tabs: EditorTab[]) {
  const serializable = tabs.map((t) => ({ ...t, results: [], errors: [], running: false }));
  try { localStorage.setItem(TABS_KEY, JSON.stringify(serializable)); } catch {}
}

function loadSettings() {
  const defaults = {
    log_queries: true,
    log_query_threads: true,
    log_profile_events: true,
    query_profiler_real_time_period_ns: true,
    query_profiler_cpu_time_period_ns: true,
    allow_introspection_functions: true,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

function saveSettings(s: Record<string, boolean>) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function splitQueries(sql: string): string[] {
  const stmts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      current += ch;
      if (inSingle && i + 1 < sql.length && sql[i + 1] === "'") {
        current += "'";
        i++;
      }
    } else if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += ch;
      if (inDouble && i + 1 < sql.length && sql[i + 1] === '"') {
        current += '"';
        i++;
      }
    } else if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
    } else if (ch === '-' && !inSingle && !inDouble && !inBacktick && i + 1 < sql.length && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += ' ';
    } else if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed) stmts.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }
  const trimmed = current.trim();
  if (trimmed) stmts.push(trimmed);
  return stmts;
}

function CellValue({ val }: { val: any }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
        onDoubleClick={() => setExpanded((e) => !e)}
        className={`${expanded ? "whitespace-pre-wrap break-all" : "truncate"} ${isNull ? "italic text-[var(--color-text-secondary)]" : isObj ? "text-[var(--color-accent)]" : ""}`}
        title={expanded ? undefined : (isObj ? JSON.stringify(val, null, 2) : display)}
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

function ResultTable({ result, pageSize, resultPage, setResultPage, onNavigate }: {
  result: QueryResult;
  pageSize: number;
  resultPage: number;
  setResultPage: (fn: (p: number) => number) => void;
  onNavigate: (path: string) => void;
}) {
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortCol, setSortCol] = useState<string>("");
  const [sortAsc, setSortAsc] = useState(true);

  const filteredRows = result.rows.filter((row) => {
    for (const [col, filter] of Object.entries(colFilters)) {
      if (!filter) continue;
      const val = row[col];
      const str = val === null || val === undefined ? "null" : String(val).toLowerCase();
      if (!str.includes(filter.toLowerCase())) return false;
    }
    return true;
  });

  const sortedRows = sortCol
    ? [...filteredRows].sort((a, b) => {
        const va = a[sortCol];
        const vb = b[sortCol];
        let cmp = 0;
        if (va === null || va === undefined) cmp = vb === null || vb === undefined ? 0 : -1;
        else if (vb === null || vb === undefined) cmp = 1;
        else if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb));
        return sortAsc ? cmp : -cmp;
      })
    : filteredRows;

  const pageRows = sortedRows.slice(resultPage * pageSize, (resultPage + 1) * pageSize);
  const hasFilters = Object.values(colFilters).some((v) => v);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      if (sortAsc) { setSortAsc(false); }
      else { setSortCol(""); setSortAsc(true); }
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
    setResultPage(() => 0);
  };

  return (
    <div>
      {result.query_id && (
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => onNavigate(`/query/${result.query_id}`)}
            className="flex items-center gap-1 rounded border border-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"
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
          <span className="text-xs text-[var(--color-text-secondary)]">
            {formatNumber(sortedRows.length)}{sortedRows.length !== result.row_count ? ` of ${formatNumber(result.row_count)}` : ""} rows in {formatElapsed(result.timing_ms)}
          </span>
          {hasFilters && (
            <button
              onClick={() => setColFilters({})}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {result.columns.length > 0 ? (
        <>
          <div className="overflow-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                  {result.columns.map((c) => (
                    <th
                      key={c.name}
                      onClick={() => toggleSort(c.name)}
                      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)] whitespace-nowrap hover:text-[var(--color-text-primary)]"
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.name}
                        {sortCol === c.name && (
                          sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        )}
                      </span>
                      <div className="text-[9px] font-normal opacity-60">{c.type}</div>
                    </th>
                  ))}
                </tr>
                {result.rows.length > 1 && (
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    {result.columns.map((c) => (
                      <th key={c.name} className="px-1 py-1">
                        <input
                          type="text"
                          value={colFilters[c.name] || ""}
                          onChange={(e) => {
                            setColFilters((prev) => ({ ...prev, [c.name]: e.target.value }));
                            setResultPage(() => 0);
                          }}
                          placeholder="Filter..."
                          className="w-full min-w-[60px] rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-secondary)]">
                    {result.columns.map((c) => (
                      <td key={c.name} className="max-w-sm px-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                        <CellValue val={row[c.name]} />
                      </td>
                    ))}
                  </tr>
                ))}
                {sortedRows.length === 0 && hasFilters && (
                  <tr>
                    <td colSpan={result.columns.length} className="px-4 py-4 text-center text-xs text-[var(--color-text-secondary)]">
                      No rows match filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {sortedRows.length > pageSize && (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs text-[var(--color-text-secondary)]">
              <span>
                {resultPage * pageSize + 1}-{Math.min((resultPage + 1) * pageSize, sortedRows.length)} of {formatNumber(sortedRows.length)}
              </span>
              <button
                onClick={() => setResultPage((p) => Math.max(0, p - 1))}
                disabled={resultPage === 0}
                className="rounded p-1 hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setResultPage((p) => p + 1)}
                disabled={(resultPage + 1) * pageSize >= sortedRows.length}
                className="rounded p-1 hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-[var(--color-text-secondary)]">Query executed successfully. No results returned.</div>
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

export function QueryEditor() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [tabs, setTabs] = useState<EditorTab[]>(loadTabs);
  const [activeTabId, setActiveTabId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_TAB_KEY) || tabs[0]?.id; } catch { return tabs[0]?.id; }
  });
  const [databases, setDatabases] = useState<string[]>(getCachedDatabases);
  const [schemaData, setSchemaData] = useState<SchemaData>(getCachedSchemaData);
  const [schemaLoading, setSchemaLoading] = useState(getCachedDatabases().length === 0);
  const [schemaStale, setSchemaStale] = useState(isSchemaStale);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [pageSize, setPageSize] = useState(() => {
    try { return Number(localStorage.getItem(PAGE_SIZE_KEY)) || 100; } catch { return 100; }
  });
  const [settings, setSettings] = useState(loadSettings);
  const editorRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const updateTab = useCallback((id: string, updates: Partial<EditorTab>) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const sqlText = activeTab?.sql || "";
  const setSQLText = useCallback((sql: string) => {
    updateTab(activeTab.id, { sql });
  }, [activeTab.id, updateTab]);

  const loadDatabases = useCallback((force = false) => {
    if (!force && getCachedDatabases().length > 0) return;
    setSchemaLoading(true);
    fetchDatabases()
      .then((d) => {
        const dbs = d.databases || [];
        setDatabases(dbs);
        setCachedDatabases(dbs);
        setSchemaStale(false);
      })
      .catch(() => {})
      .finally(() => setSchemaLoading(false));
  }, []);

  useEffect(() => { loadDatabases(); }, [loadDatabases]);

  const loadTables = useCallback(async (db: string) => {
    const current = getCachedSchemaData();
    if (current[db]?.tables) return;
    setSchemaData((prev) => ({ ...prev, [db]: { ...prev[db], loading: true } }));
    try {
      const res = await fetchTables(db);
      const entry = { tables: res.tables || [], loading: false };
      setSchemaData((prev) => ({ ...prev, [db]: entry }));
      updateSchemaDb(db, entry);
    } catch {
      const entry = { loading: false };
      setSchemaData((prev) => ({ ...prev, [db]: { ...prev[db], ...entry } }));
      updateSchemaDb(db, entry);
    }
  }, []);

  useEffect(() => {
    const cached = getCachedSchemaData();
    const dbsToLoad = extractDatabaseNames(sqlText).filter(
      (db) => databases.includes(db) && !cached[db]?.tables
    );
    if (dbsToLoad.length === 0) return;
    let cancelled = false;
    const load = async () => {
      for (const db of dbsToLoad) {
        if (cancelled) break;
        await loadTables(db);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sqlText, databases, loadTables]);

  const loadColumns = useCallback(async (db: string, table: string) => {
    try {
      const res = await fetchColumns(db, table);
      setSchemaData((prev) => {
        const dbEntry = prev[db] || {};
        const tables = (dbEntry.tables || []).map((t) =>
          t.name === table ? { ...t, columns: res.columns || [] } : t
        );
        const updated = { ...prev, [db]: { ...dbEntry, tables } };
        setCachedSchemaData(updated);
        return updated;
      });
    } catch {}
  }, []);

  useEffect(() => {
    saveTabs(tabs);
    try { localStorage.setItem(ACTIVE_TAB_KEY, activeTab.id); } catch {}
  }, [tabs, activeTab.id]);

  useEffect(() => {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(pageSize)); } catch {}
  }, [pageSize]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

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

  const buildSettingsMap = useCallback((): Record<string, string> => {
    const s: Record<string, string> = {};
    s["log_queries"] = settings.log_queries ? "1" : "0";
    s["log_query_threads"] = settings.log_query_threads ? "1" : "0";
    s["log_profile_events"] = settings.log_profile_events ? "1" : "0";
    s["query_profiler_real_time_period_ns"] = settings.query_profiler_real_time_period_ns ? "1000000000" : "0";
    s["query_profiler_cpu_time_period_ns"] = settings.query_profiler_cpu_time_period_ns ? "1000000000" : "0";
    s["allow_introspection_functions"] = settings.allow_introspection_functions ? "1" : "0";
    return s;
  }, [settings]);

  const runAllQueries = useCallback(async (sqlToRun?: string) => {
    const input = sqlToRun || sqlText;
    if (!input.trim()) return;
    const stmts = splitQueries(input);
    if (stmts.length === 0) return;

    updateTab(activeTab.id, { results: [], errors: [], running: true });
    abortRef.current = new AbortController();
    startTimer();

    const allResults: QueryResult[] = [];
    const allErrors: string[] = [];
    const chSettings = buildSettingsMap();

    for (let i = 0; i < stmts.length; i++) {
      try {
        const r = await executeQuery(stmts[i], 5000, chSettings);
        allResults.push(r);
        allErrors.push("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") break;
        allResults.push({ columns: [], rows: [], row_count: 0, timing_ms: 0, query_id: "" });
        allErrors.push(e instanceof Error ? e.message : "Query failed");
      }
    }

    updateTab(activeTab.id, { results: allResults, errors: allErrors, running: false, resultPage: 0 });
    stopTimer();
    abortRef.current = null;
  }, [sqlText, activeTab.id, updateTab, startTimer, stopTimer, buildSettingsMap]);

  const runSelection = useCallback(async () => {
    const view = editorRef.current?.view;
    if (!view) return runAllQueries();

    const sel = view.state.selection.main;
    const selectedText = view.state.sliceDoc(sel.from, sel.to).trim();
    if (selectedText) {
      return runAllQueries(selectedText);
    }

    const fullText = view.state.doc.toString();
    const stmts = splitQueries(fullText);
    const pos = sel.head;
    let charPos = 0;
    for (const stmt of stmts) {
      const start = fullText.indexOf(stmt, charPos);
      const end = start + stmt.length;
      if (pos >= start && pos <= end) {
        return runAllQueries(stmt);
      }
      charPos = end + 1;
    }
    return runAllQueries();
  }, [runAllQueries]);

  const cancelQuery = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      stopTimer();
      updateTab(activeTab.id, { running: false });
    }
  }, [stopTimer, activeTab.id, updateTab]);

  const formatSQL = useCallback(() => {
    try {
      const formatted = sqlFormat(sqlText, { tabWidth: 2, keywordCase: "upper", linesBetweenQueries: 2 });
      setSQLText(formatted);
    } catch {}
  }, [sqlText, setSQLText]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        runSelection();
      } else {
        runAllQueries();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      formatSQL();
    }
  }, [runAllQueries, runSelection, formatSQL]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (key.startsWith("db:")) {
          const db = key.slice(3);
          if (!schemaData[db]?.tables) loadTables(db);
        } else if (key.startsWith("tbl:")) {
          const [dbTable] = key.slice(4).split(".");
          const tbl = key.slice(4).slice(dbTable.length + 1);
          const table = schemaData[dbTable]?.tables?.find((t) => t.name === tbl);
          if (table && !table.columns) loadColumns(dbTable, tbl);
        }
      }
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
      setSQLText(sqlText + text);
    }
  };

  const buildSQLNamespace = (): SQLNamespace => {
    const ns: SQLNamespace = {};
    for (const db of databases) {
      const tables: { [table: string]: string[] } = {};
      for (const t of schemaData[db]?.tables || []) {
        tables[t.name] = (t.columns || []).map((c) => c.name);
      }
      ns[db] = tables;
    }
    return ns;
  };

  const addTab = () => {
    const newTab: EditorTab = { id: uid(), name: `Query ${tabs.length + 1}`, sql: "SELECT ", results: [], errors: [], running: false, resultPage: 0 };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    if (activeTabId === id) {
      const newIdx = Math.min(idx, next.length - 1);
      setActiveTabId(next[newIdx].id);
    }
    setTabs(next);
  };

  const renameTab = (id: string, name: string) => {
    updateTab(id, { name });
  };

  const cmTheme = theme === "dark" ? oneDark : undefined;

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
              onClick={() => { invalidateSchema(); setSchemaData({}); loadDatabases(true); }}
              disabled={schemaLoading}
              className="flex items-center gap-1 rounded p-1 hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
              title="Reload schema"
            >
              <RefreshCw className={`h-3 w-3 ${schemaLoading ? "animate-spin" : ""}`} />
              {schemaStale && !schemaLoading && <AlertTriangle className="h-3 w-3 text-[var(--color-warning)]" />}
            </button>
          </div>
        </div>
        <div className="p-1">
          {databases.length > 0 ? databases.map((dbName) => (
            <div key={dbName}>
              <button
                onClick={() => toggleExpand(`db:${dbName}`)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
              >
                {expanded.has(`db:${dbName}`) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <span className="truncate">{dbName}</span>
                {schemaData[dbName]?.loading && <Loader2 className="ml-1 h-3 w-3 animate-spin shrink-0" />}
                {!schemaData[dbName]?.loading && schemaData[dbName]?.tables && (
                  <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-secondary)]">{schemaData[dbName].tables!.length}</span>
                )}
              </button>
              {expanded.has(`db:${dbName}`) && (schemaData[dbName]?.tables || []).map((t) => (
                <div key={t.name} className="group relative">
                  <div className="flex items-center">
                    <button
                      onClick={() => toggleExpand(`tbl:${dbName}.${t.name}`)}
                      className="flex flex-1 min-w-0 items-center gap-1 rounded px-2 py-1 pl-5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
                    >
                      {expanded.has(`tbl:${dbName}.${t.name}`) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <Table2 className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" />
                      <span className="truncate">{t.name}</span>
                      {t.row_count > 0 && <span className="ml-1 shrink-0 text-[10px] text-[var(--color-text-secondary)]">({formatNumber(t.row_count)})</span>}
                    </button>
                    <button
                      onClick={() => setSQLText(`SELECT * FROM ${dbName}.${t.name}`)}
                      className="mr-1 shrink-0 rounded p-1 text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]"
                      title="SELECT * FROM"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  {expanded.has(`tbl:${dbName}.${t.name}`) && (
                    <div className="pl-10">
                      {t.columns ? t.columns.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => insertAtCursor(c.name)}
                          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0 text-[9px] opacity-60">{c.type}</span>
                        </button>
                      )) : (
                        <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading columns...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {expanded.has(`db:${dbName}`) && !schemaData[dbName]?.tables && !schemaData[dbName]?.loading && (
                <div className="px-5 py-1 text-[10px] text-[var(--color-text-secondary)]">Failed to load tables</div>
              )}
            </div>
          )) : (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-[var(--color-text-secondary)]">
              {schemaLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {schemaLoading ? "Loading databases..." : "No databases found"}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--color-border)]">
          <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-0.5">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`group/tab flex items-center gap-1 rounded-t px-3 py-1.5 text-xs cursor-pointer ${tab.id === activeTabId ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] border-t-2 border-x border-[var(--color-border)] border-b-[var(--color-bg-primary)] -mb-px" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span
                  contentEditable={tab.id === activeTabId}
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const newName = e.currentTarget.textContent?.trim();
                    if (newName) renameTab(tab.id, newName);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                  className="outline-none max-w-[120px] truncate"
                >
                  {tab.name}
                </span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-[var(--color-bg-tertiary)] group-hover/tab:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {tab.running && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
              </div>
            ))}
            <button
              onClick={addTab}
              className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              title="New tab"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5">
            {activeTab?.running ? (
              <button
                onClick={cancelQuery}
                className="flex items-center gap-1.5 rounded bg-[var(--color-error)] px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            ) : (
              <button
                onClick={() => runAllQueries()}
                disabled={!sqlText.trim()}
                className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
            )}
            <span className="text-[10px] text-[var(--color-text-secondary)]" title="Run all queries">{mod}+Enter</span>
            <span className="text-[10px] text-[var(--color-text-secondary)]" title="Run selection or statement at cursor">/ {mod}+Shift+Enter</span>
            {activeTab?.running && (
              <span className="ml-2 flex items-center gap-1.5 text-xs font-mono text-[var(--color-accent)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {formatElapsed(elapsed)}
              </span>
            )}
            {!activeTab?.running && activeTab?.results.length > 0 && (
              <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                {activeTab.results.length} {activeTab.results.length === 1 ? "query" : "queries"} executed
              </span>
            )}
            <button
              onClick={formatSQL}
              className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              title={`Format SQL (${mod}+Shift+F)`}
            >
              Format
            </button>
            <button
              onClick={() => setShowSettings((p) => !p)}
              className={`ml-auto flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs ${showSettings ? "bg-[var(--color-bg-tertiary)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
              title="Query settings"
            >
              <Settings2 className="h-3 w-3" />
              Settings
            </button>
          </div>
          {showSettings && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-4 py-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-primary)]" title="Log this query to query_log">
                <input type="checkbox" checked={settings.log_queries} onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, log_queries: e.target.checked }))} className="accent-[var(--color-accent)]" />
                log_queries
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-primary)]" title="Log per-thread profiling data to query_thread_log">
                <input type="checkbox" checked={settings.log_query_threads} onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, log_query_threads: e.target.checked }))} className="accent-[var(--color-accent)]" />
                log_query_threads
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-primary)]" title="Collect ProfileEvents for the query (used in Storage, Overview tabs)">
                <input type="checkbox" checked={settings.log_profile_events} onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, log_profile_events: e.target.checked }))} className="accent-[var(--color-accent)]" />
                log_profile_events
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-primary)]" title="Enable real-time (wall clock) profiler for flame graphs">
                <input type="checkbox" checked={settings.query_profiler_real_time_period_ns} onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, query_profiler_real_time_period_ns: e.target.checked }))} className="accent-[var(--color-accent)]" />
                real_time_profiler
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-primary)]" title="Enable CPU time profiler for flame graphs">
                <input type="checkbox" checked={settings.query_profiler_cpu_time_period_ns} onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, query_profiler_cpu_time_period_ns: e.target.checked }))} className="accent-[var(--color-accent)]" />
                cpu_profiler
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-primary)]" title="Allow introspection functions like addressToLine, demangle">
                <input type="checkbox" checked={settings.allow_introspection_functions} onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, allow_introspection_functions: e.target.checked }))} className="accent-[var(--color-accent)]" />
                allow_introspection_functions
              </label>
              <div className="ml-auto flex items-center gap-1 text-xs text-[var(--color-text-primary)]">
                Rows/page:
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-xs text-[var(--color-text-primary)]"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                </select>
              </div>
            </div>
          )}
          <div className="h-48">
            <CodeMirror
              ref={editorRef}
              value={sqlText}
              onChange={setSQLText}
              theme={cmTheme}
              extensions={[keymap.of([{ key: "Tab", run: acceptCompletion }]), sql({ schema: buildSQLNamespace() })]}
              basicSetup={{ lineNumbers: true, foldGutter: false }}
              className="h-full text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:!font-mono [&_.cm-scroller]:text-[13px]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-[var(--color-bg-primary)]">
          {activeTab && activeTab.results.length === 0 && activeTab.errors.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-[var(--color-text-secondary)]">
              <Play className="h-8 w-8 opacity-30" />
              <p className="text-sm">Write a query and press Run</p>
              <p className="text-xs opacity-60">{mod}+Enter to run all &middot; {mod}+Shift+Enter to run selection</p>
            </div>
          )}

          {activeTab && (activeTab.results.length > 0 || activeTab.errors.length > 0) && (
            <div className="space-y-4 p-3">
              {activeTab.results.map((result, i) => (
                <div key={i}>
                  {activeTab.results.length > 1 && (
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                      Query {i + 1}
                      {result.timing_ms > 0 && <span className="ml-2 normal-case tracking-normal">{formatElapsed(result.timing_ms)}</span>}
                    </div>
                  )}
                  {activeTab.errors[i] ? (
                    <div className="rounded-lg border border-[var(--color-error)] bg-red-900/20 px-4 py-3 text-sm text-[var(--color-error)]">
                      {activeTab.errors[i]}
                    </div>
                  ) : (
                    <ResultTable
                      result={result}
                      pageSize={pageSize}
                      resultPage={activeTab.resultPage}
                      setResultPage={(fn) => updateTab(activeTab.id, { resultPage: fn(activeTab.resultPage) })}
                      onNavigate={(path) => navigate(path)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
