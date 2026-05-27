import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { sql, SQLNamespace } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { acceptCompletion } from "@codemirror/autocomplete";
import { format as sqlFormat } from "sql-formatter";
import { Play, Database, ChevronRight, ChevronDown, Loader2, ExternalLink, Table2, Square, Copy, Check, RefreshCw, Settings2, ChevronLeft, ChevronRightIcon, Plus, X, ArrowUp, ArrowDown, AlertTriangle, Bookmark, BookmarkCheck, Trash2, Search, Variable, Download, Upload } from "lucide-react";
import { executeQuery, fetchDatabases, fetchTables, fetchColumns } from "../api/client";
import type { QueryResult } from "../api/types";
import { formatNumber } from "../utils";
import { useTheme } from "../api/theme";
import {
  getCachedDatabases, getCachedSchemaData, setCachedDatabases, setCachedSchemaData,
  updateSchemaDb, invalidateSchema, isSchemaStale, extractDatabaseNames,
} from "../api/schema-cache";
import type { SchemaData } from "../api/schema-cache";
import {
  loadSavedQueries, addSavedQuery, updateSavedQuery, deleteSavedQuery,
  detectParams, resolveParams, importSavedQueries,
  loadParamSets, addParamSet, deleteParamSet, importParamSets,
} from "../api/saved-queries";
import type { SavedQuery } from "../api/saved-queries";
import type { ParamSet } from "../api/saved-queries";

interface EditorTab {
  id: string;
  name: string;
  sql: string;
  results: QueryResult[];
  errors: string[];
  running: boolean;
  resultPage: number;
  paramValues: Record<string, string>;
}

const TABS_KEY = "ch-editor-tabs";
const ACTIVE_TAB_KEY = "ch-editor-active-tab";
const PAGE_SIZE_KEY = "ch-editor-page-size";
const SETTINGS_KEY = "ch-editor-settings";
const SIDEBAR_SECTIONS_KEY = "ch-editor-sidebar-sections";

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
  return [{ id: uid(), name: "Query 1", sql: "SELECT ", results: [], errors: [], running: false, resultPage: 0, paramValues: {} }];
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
    enable_params: true,
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

interface SidebarSections {
  schema: boolean;
  saved: boolean;
  params: boolean;
}

function loadSidebarSections(): SidebarSections {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { schema: true, saved: false, params: true };
}

function saveSidebarSections(s: SidebarSections) {
  try { localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(s)); } catch {}
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
  const [sidebarSections, setSidebarSections] = useState<SidebarSections>(loadSidebarSections);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(loadSavedQueries);
  const [savedSearch, setSavedSearch] = useState("");
  const [savingName, setSavingName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [paramSets, setParamSets] = useState<ParamSet[]>(loadParamSets);
  const [savingParamSetName, setSavingParamSetName] = useState("");
  const [showSaveParamSetDialog, setShowSaveParamSetDialog] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const editorRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importParamsInputRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const sqlText = activeTab?.sql || "";
  const paramValues = activeTab?.paramValues || {};

  const detectedParams = settings.enable_params ? detectParams(sqlText) : [];

  const updateTab = useCallback((id: string, updates: Partial<EditorTab>) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const setSQLText = useCallback((sql: string) => {
    updateTab(activeTab.id, { sql });
  }, [activeTab.id, updateTab]);

  const setParamValues = useCallback((fnOrValues: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTab.id) return t;
      const next = typeof fnOrValues === "function" ? fnOrValues(t.paramValues || {}) : fnOrValues;
      return { ...t, paramValues: next };
    }));
  }, [activeTab.id]);

  const toggleSection = useCallback((key: keyof SidebarSections) => {
    setSidebarSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSidebarSections(next);
      return next;
    });
  }, []);

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

  const emptyParams = detectedParams.filter((p) => !paramValues[p]?.trim());

  const resolvedSQL = useCallback((raw: string): string => {
    if (detectedParams.length === 0) return raw;
    return resolveParams(raw, paramValues);
  }, [detectedParams, paramValues]);

  const runAllQueries = useCallback(async (sqlToRun?: string) => {
    const input = sqlToRun || sqlText;
    if (!input.trim()) return;
    if (emptyParams.length > 0) {
      updateTab(activeTab.id, {
        results: [],
        errors: [`Missing parameter values: ${emptyParams.map((p) => `{{${p}}}`).join(", ")}`],
        running: false,
        resultPage: 0,
      });
      return;
    }
    const resolved = resolvedSQL(input);
    const stmts = splitQueries(resolved);
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
  }, [sqlText, activeTab.id, updateTab, startTimer, stopTimer, buildSettingsMap, resolvedSQL, emptyParams]);

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
    setFormatting(true);
    requestAnimationFrame(() => {
      try {
        let input = sqlText;
        const placeholders: string[] = [];
        if (settings.enable_params) {
          input = input.replace(/(?<!\\)\{\{(\w+)\}\}/g, (_m, _p: string) => {
            placeholders.push(_m);
            return `__PARAM_${placeholders.length - 1}__`;
          });
        }
        const formatted = sqlFormat(input, { tabWidth: 2, keywordCase: "upper", linesBetweenQueries: 2 });
        const restored = formatted.replace(/__PARAM_(\d+)__/g, (_m, idx: string) => placeholders[Number(idx)]);
        setSQLText(restored);
      } catch {}
      setFormatting(false);
    });
  }, [sqlText, setSQLText, settings.enable_params]);

  const runAllQueriesRef = useRef(runAllQueries);
  runAllQueriesRef.current = runAllQueries;
  const runSelectionRef = useRef(runSelection);
  runSelectionRef.current = runSelection;
  const formatSQLRef = useRef(formatSQL);
  formatSQLRef.current = formatSQL;

  const cmKeymap = useMemo(() => Prec.highest(keymap.of([
    { key: "Tab", run: acceptCompletion },
    {
      key: "Mod-Enter",
      run: () => { runAllQueriesRef.current(); return true; },
    },
    {
      key: "Mod-Shift-Enter",
      run: () => { runSelectionRef.current(); return true; },
    },
    {
      key: "Mod-Shift-f",
      run: () => { formatSQLRef.current(); return true; },
    },
    {
      key: "Alt-Shift-f",
      run: () => { formatSQLRef.current(); return true; },
    },
  ])), []);

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
    const newTab: EditorTab = { id: uid(), name: `Query ${tabs.length + 1}`, sql: "SELECT ", results: [], errors: [], running: false, resultPage: 0, paramValues: {} };
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

  const handleSave = () => {
    const trimmed = savingName.trim();
    if (!trimmed) return;
    const paramsToSave: Record<string, string> = {};
    for (const p of detectedParams) {
      if (paramValues[p]?.trim()) paramsToSave[p] = paramValues[p];
    }
    addSavedQuery(trimmed, sqlText, paramsToSave);
    setSavedQueries(loadSavedQueries());
    setShowSaveDialog(false);
    setSavingName("");
  };

  const handleLoadSaved = (q: SavedQuery) => {
    const pv: Record<string, string> = {};
    if (q.params) {
      for (const [k, v] of Object.entries(q.params)) {
        if (v) pv[k] = v;
      }
    }
    updateTab(activeTab.id, { sql: q.sql, results: [], errors: [], paramValues: pv });
    const params = detectParams(q.sql);
    if (params.length > 0) {
      setSidebarSections((prev) => {
        const next = { ...prev, params: true };
        saveSidebarSections(next);
        return next;
      });
    }
  };

  const handleDeleteSaved = (id: string) => {
    deleteSavedQuery(id);
    setSavedQueries(loadSavedQueries());
  };

  const handleOverwriteSaved = (id: string) => {
    const paramsToSave: Record<string, string> = {};
    for (const p of detectedParams) {
      if (paramValues[p]?.trim()) paramsToSave[p] = paramValues[p];
    }
    updateSavedQuery(id, { sql: sqlText, params: paramsToSave });
    setSavedQueries(loadSavedQueries());
  };

  const handleExport = () => {
    const queries = loadSavedQueries();
    if (queries.length === 0) return;
    const blob = new Blob([JSON.stringify(queries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clickhouse-saved-queries-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed)) return;
        const valid = parsed.filter(
          (q: any) => q && typeof q.name === "string" && typeof q.sql === "string"
        );
        if (valid.length === 0) return;
        importSavedQueries(valid);
        setSavedQueries(loadSavedQueries());
        setSidebarSections((prev) => {
          const next = { ...prev, saved: true };
          saveSidebarSections(next);
          return next;
        });
      } catch {}
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSaveParamSet = () => {
    const trimmed = savingParamSetName.trim();
    if (!trimmed) return;
    const pv: Record<string, string> = {};
    for (const p of detectedParams) {
      if (paramValues[p]?.trim()) pv[p] = paramValues[p];
    }
    addParamSet(trimmed, pv);
    setParamSets(loadParamSets());
    setShowSaveParamSetDialog(false);
    setSavingParamSetName("");
  };

  const handleApplyParamSet = (ps: ParamSet) => {
    setParamValues((prev) => ({ ...prev, ...ps.params }));
  };

  const handleDeleteParamSet = (id: string) => {
    deleteParamSet(id);
    setParamSets(loadParamSets());
  };

  const handleExportParamSets = () => {
    const sets = loadParamSets();
    if (sets.length === 0) return;
    const blob = new Blob([JSON.stringify(sets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clickhouse-param-sets-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportParamSets = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed)) return;
        const valid = parsed.filter(
          (s: any) => s && typeof s.name === "string" && typeof s.params === "object"
        );
        if (valid.length === 0) return;
        importParamSets(valid);
        setParamSets(loadParamSets());
      } catch {}
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const matchedSaved = savedQueries.filter((q) => {
    if (!savedSearch.trim()) return true;
    const term = savedSearch.toLowerCase();
    return q.name.toLowerCase().includes(term) || q.sql.toLowerCase().includes(term);
  });

  const activeSavedId = savedQueries.find((q) => q.sql === sqlText)?.id;

  const cmTheme = theme === "dark" ? oneDark : undefined;

  const AccordionHeader = ({ label, icon, sectionKey, extra }: {
    label: string;
    icon: React.ReactNode;
    sectionKey: keyof SidebarSections;
    extra?: React.ReactNode;
  }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="flex w-full items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
    >
      {sidebarSections[sectionKey] ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      {icon}
      <span className="truncate">{label}</span>
      {extra}
    </button>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-y-auto overflow-x-hidden flex flex-col">
        <AccordionHeader
          label="Schema"
          icon={<Database className="h-3.5 w-3.5" />}
          sectionKey="schema"
          extra={
            <button
              onClick={(e) => { e.stopPropagation(); invalidateSchema(); setSchemaData({}); loadDatabases(true); }}
              disabled={schemaLoading}
              className="ml-auto rounded p-1 hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50"
              title="Reload schema"
            >
              <RefreshCw className={`h-3 w-3 ${schemaLoading ? "animate-spin" : ""}`} />
              {schemaStale && !schemaLoading && <AlertTriangle className="ml-0.5 inline h-3 w-3 text-[var(--color-warning)]" />}
            </button>
          }
        />
        {sidebarSections.schema && (
          <div className="border-b border-[var(--color-border)] p-1">
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
        )}

        <AccordionHeader
          label="Saved Queries"
          icon={<Bookmark className="h-3.5 w-3.5" />}
          sectionKey="saved"
          extra={
            <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => importInputRef.current?.click()}
                className="rounded p-1 hover:bg-[var(--color-bg-tertiary)]"
                title="Import saved queries"
              >
                <Download className="h-3 w-3" />
              </button>
              <button
                onClick={handleExport}
                disabled={savedQueries.length === 0}
                className="rounded p-1 hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
                title="Export saved queries"
              >
                <Upload className="h-3 w-3" />
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
              <span className="text-[10px] font-normal normal-case tracking-normal">
                {savedQueries.length}
              </span>
            </div>
          }
        />
        {sidebarSections.saved && (
          <div className="border-b border-[var(--color-border)]">
            <div className="px-2 py-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                <input
                  type="text"
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  placeholder="Search saved queries..."
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] py-1 pl-7 pr-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {matchedSaved.length > 0 ? matchedSaved.map((q) => {
                const params = detectParams(q.sql);
                const isActive = q.id === activeSavedId;
                return (
                  <div
                    key={q.id}
                    className={`group/saved flex flex-col gap-0.5 border-b border-[var(--color-border)] px-2 py-1.5 last:border-0 ${isActive ? "bg-[var(--color-bg-tertiary)]" : "hover:bg-[var(--color-bg-tertiary)]"}`}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleLoadSaved(q)}
                        className="flex-1 truncate text-left text-xs font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] hover:underline"
                        title={`Load "${q.name}" into editor`}
                      >
                        {q.name}
                      </button>
                      <button
                        onClick={() => handleLoadSaved(q)}
                        className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-accent)]"
                        title="Load into editor"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      {isActive && (
                        <button
                          onClick={() => handleOverwriteSaved(q.id)}
                          className="shrink-0 rounded p-0.5 text-[var(--color-accent)] hover:bg-[var(--color-bg-secondary)]"
                          title="Update saved query with current SQL"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteSaved(q.id)}
                        className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] opacity-0 hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-error)] group-hover/saved:opacity-100"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
                        {q.sql.replace(/\s+/g, " ").trim().slice(0, 60)}
                        {q.sql.length > 60 ? "..." : ""}
                      </span>
                    </div>
                    {params.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {params.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center rounded bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-accent)]"
                          >
                            <Variable className="mr-0.5 h-2.5 w-2.5" />
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }) : (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
                  {savedSearch ? "No matching queries" : "No saved queries yet"}
                </div>
              )}
            </div>
          </div>
        )}

        {(() => {
          const showInputs = settings.enable_params && sidebarSections.params && detectedParams.length > 0;
          const showEmpty = settings.enable_params && sidebarSections.params && detectedParams.length === 0;
          return (
            <>
              <AccordionHeader
                label={`Parameters${detectedParams.length > 0 ? ` (${detectedParams.length})` : ""}`}
                icon={<Variable className="h-3.5 w-3.5" />}
                sectionKey="params"
                extra={
                  <label
                    className="ml-auto flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-[var(--color-text-secondary)]"
                    title="Enable {{param}} parameter detection and substitution"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={settings.enable_params}
                      onChange={(e) => setSettings((s: Record<string, boolean>) => ({ ...s, enable_params: e.target.checked }))}
                      className="accent-[var(--color-accent)]"
                    />
                    On
                  </label>
                }
              />
              {showInputs && (
                <div className="border-b border-[var(--color-border)] px-3 py-2 space-y-2">
                  {detectedParams.map((p) => (
                    <div key={p}>
                      <label className="mb-0.5 block text-[10px] font-medium text-[var(--color-text-secondary)]">
                        {`{{${p}}}`}
                      </label>
                      <input
                        type="text"
                        value={paramValues[p] || ""}
                        onChange={(e) => setParamValues((prev) => ({ ...prev, [p]: e.target.value }))}
                        placeholder={p}
                        className={`w-full rounded border px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] ${!paramValues[p]?.trim() ? "border-[var(--color-error)]" : "border-[var(--color-border)]"} bg-[var(--color-bg-primary)]`}
                      />
                    </div>
                  ))}
                  {detectedParams.length > 0 && (
                    <div className="flex gap-1 pt-1">
                      <button
                        onClick={() => { setSavingParamSetName(""); setShowSaveParamSetDialog(true); }}
                        className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
                      >
                        Save as set
                      </button>
                    </div>
                  )}
                  {paramSets.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Param sets</span>
                        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => importParamsInputRef.current?.click()}
                            className="rounded p-0.5 hover:bg-[var(--color-bg-tertiary)]"
                            title="Import param sets"
                          >
                            <Download className="h-3 w-3" />
                          </button>
                          <button
                            onClick={handleExportParamSets}
                            className="rounded p-0.5 hover:bg-[var(--color-bg-tertiary)]"
                            title="Export param sets"
                          >
                            <Upload className="h-3 w-3" />
                          </button>
                          <input
                            ref={importParamsInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleImportParamSets}
                            className="hidden"
                          />
                        </div>
                      </div>
                      {paramSets.map((ps) => (
                        <div key={ps.id} className="group/ps flex items-center gap-1">
                          <button
                            onClick={() => handleApplyParamSet(ps)}
                            className="flex-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-accent)]"
                            title={`Apply: ${Object.entries(ps.params).map(([k, v]) => `${k}=${v}`).join(", ")}`}
                          >
                            {ps.name}
                          </button>
                          <button
                            onClick={() => handleDeleteParamSet(ps.id)}
                            className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] opacity-0 hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-error)] group-hover/ps:opacity-100"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[9px] text-[var(--color-text-secondary)]">
                    Use \&#123;&#123; to escape literal &#123;&#123; in SQL
                  </p>
                </div>
              )}
              {showEmpty && (
                <div className="border-b border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
                  <p>No parameters detected.</p>
                  <p className="mt-1 text-[10px]">Use {"{{param_name}}"} syntax to add parameters.</p>
                </div>
              )}
              {showSaveParamSetDialog && (
                <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2">
                  <div className="mb-1.5 text-[10px] font-medium text-[var(--color-text-secondary)]">Save parameter set as</div>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={savingParamSetName}
                      onChange={(e) => setSavingParamSetName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveParamSet(); if (e.key === "Escape") setShowSaveParamSetDialog(false); }}
                      placeholder="Set name..."
                      autoFocus
                      className="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
                    />
                    <button
                      onClick={handleSaveParamSet}
                      disabled={!savingParamSetName.trim()}
                      className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setShowSaveParamSetDialog(false)}
                      className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {showSaveDialog && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2">
            <div className="mb-1.5 text-[10px] font-medium text-[var(--color-text-secondary)]">Save current query as</div>
            <div className="flex gap-1">
              <input
                type="text"
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSaveDialog(false); }}
                placeholder="Query name..."
                autoFocus
                className="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={handleSave}
                disabled={!savingName.trim()}
                className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setShowSaveDialog(false)}
                className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
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
              disabled={formatting}
              className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
              title={`Format SQL (${mod}+Shift+F or Alt+Shift+F)`}
            >
              {formatting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Format"}
            </button>
            <button
              onClick={() => {
                if (activeSavedId) {
                  handleOverwriteSaved(activeSavedId);
                } else {
                  setSavingName(activeTab.name);
                  setShowSaveDialog(true);
                }
              }}
              className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs ${activeSavedId ? "text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
              title={activeSavedId ? "Update saved query" : `Save query (${mod}+S)`}
            >
              {activeSavedId ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
              {activeSavedId ? "Saved" : "Save"}
            </button>
            <button
              onClick={() => setShowSettings((p) => !p)}
              className={`ml-auto flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs ${showSettings ? "bg-[var(--color-bg-tertiary)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
              title="Query settings"
            >
              <Settings2 className="h-3 w-3" />
              Query settings
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
              extensions={[cmKeymap, sql({ schema: buildSQLNamespace() })]}
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
