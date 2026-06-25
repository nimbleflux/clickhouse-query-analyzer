import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { sql, type SQLNamespace } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { acceptCompletion } from "@codemirror/autocomplete";
import { format as sqlFormat } from "sql-formatter";
import { Play, Loader2, Square, Plus, X, Bookmark, BookmarkCheck, Settings2, Share2 } from "lucide-react";
import { executeQuery, fetchDatabases, fetchTables, fetchColumns } from "@/api/client";
import type { QueryResult } from "@/api/types";
import { useTheme } from "@/api/theme";
import { ConfirmDialog } from "@/components/ui/dialog";
import { NotConnectedState } from "@/components/ui/state";
import { buildShareableUrl, readSnapshotFromLocation } from "@/lib/snapshot";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  getCachedDatabases, getCachedSchemaData, setCachedDatabases, setCachedSchemaData,
  updateSchemaDb, invalidateSchema, isSchemaStale, extractDatabaseNames,
} from "@/api/schema-cache";
import type { SchemaData } from "@/api/schema-cache";
import {
  loadSavedQueries, addSavedQuery, updateSavedQuery, deleteSavedQuery,
  detectParams, resolveParams, importSavedQueries,
  loadParamSets, addParamSet, deleteParamSet, importParamSets,
} from "@/api/saved-queries";
import type { SavedQuery } from "@/api/saved-queries";
import type { ParamSet } from "@/api/saved-queries";
import {
  type EditorTab, type SidebarSections, type HistoryEntry, type EditorSettings,
  loadTabs, saveTabs, makeEmptyTab,
  loadSettings, saveSettings,
  loadSidebarSections, saveSidebarSections,
  loadHistory, addToHistory, clearHistory,
  PAGE_SIZE_KEY,
} from "./editor/storage";
import { splitQueries, formatElapsed, mod } from "./editor/utils";
import { ResultTable } from "./editor/ResultTable";
import { SchemaSidebar } from "./editor/SchemaSidebar";
import { SavedQueriesPanel } from "./editor/SavedQueriesPanel";
import { HistoryPanel } from "./editor/HistoryPanel";
import { ParametersPanel } from "./editor/ParametersPanel";
import { SettingsBar, SaveQueryDialog } from "./editor/SettingsBar";
import { SectionDivider } from "./editor/AccordionSection";

export function QueryEditor({ connected }: { connected: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const copy = useCopyToClipboard();
  const [tabs, setTabs] = useState<EditorTab[]>(loadTabs);
  const [activeTabId, setActiveTabId] = useState(() => {
    try { return localStorage.getItem("ch-editor-active-tab") || tabs[0]?.id; } catch { return tabs[0]?.id; }
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
  const [settings, setSettings] = useState<EditorSettings>(loadSettings);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return Number(localStorage.getItem("ch-editor-sidebar-width")) || 256; } catch { return 256; }
  });
  const [editorHeight, setEditorHeight] = useState(() => {
    try { return Math.max(120, Number(localStorage.getItem("ch-editor-editor-height")) || 192); } catch { return 192; }
  });
  const [sidebarSections, setSidebarSections] = useState<SidebarSections>(loadSidebarSections);
  const [sectionHeights, setSectionHeights] = useState(() => {
    try {
      const raw = localStorage.getItem("ch-editor-section-heights");
      if (raw) return JSON.parse(raw);
    } catch {}
    return { schema: 0.4, saved: 0.3, params: 0.3 };
  });
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(loadSavedQueries);
  const [savedSearch, setSavedSearch] = useState("");
  const [savingName, setSavingName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [pendingSql, setPendingSql] = useState<string | null>(null);
  const [paramSets, setParamSets] = useState<ParamSet[]>(loadParamSets);
  const [queryHistory, setQueryHistory] = useState<HistoryEntry[]>(loadHistory);
  const [savingParamSetName, setSavingParamSetName] = useState("");
  const [showSaveParamSetDialog, setShowSaveParamSetDialog] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const editorRef = useRef<unknown>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const sqlText = activeTab?.sql || "";
  const paramValues = activeTab?.paramValues || {};

  const detectedParams = settings.enable_params ? detectParams(sqlText) : [];

  const updateTab = useCallback((id: string, updates: Partial<EditorTab>) => {
    setTabs((prev) => prev.map((t) => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const setSQLText = useCallback((newSql: string) => {
    updateTab(activeTab.id, { sql: newSql });
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

  useEffect(() => { if (connected) loadDatabases(); }, [loadDatabases, connected]);

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
    try { localStorage.setItem("ch-editor-active-tab", activeTab.id); } catch {}
  }, [tabs, activeTab.id]);

  useEffect(() => {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(pageSize)); } catch {}
  }, [pageSize]);

  useEffect(() => { saveSettings(settings); }, [settings]);

  useEffect(() => {
    try { localStorage.setItem("ch-editor-sidebar-width", String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try { localStorage.setItem("ch-editor-editor-height", String(editorHeight)); } catch {}
  }, [editorHeight]);

  useEffect(() => {
    try { localStorage.setItem("ch-editor-section-heights", JSON.stringify(sectionHeights)); } catch {}
  }, [sectionHeights]);

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

    if (!settings.readonly && hasDestructiveStatement(stmts)) {
      setPendingSql(input);
      return;
    }

    executeStatements(stmts, input);
  }, [sqlText, activeTab.id, updateTab, resolvedSQL, emptyParams, settings.readonly]);

  const executeStatements = useCallback(async (stmts: string[], historyInput: string) => {
    updateTab(activeTab.id, { results: [], errors: [], running: true, resultPage: 0, statements: stmts });
    abortRef.current = new AbortController();
    startTimer();

    const allResults: QueryResult[] = [];
    const allErrors: string[] = [];
    const chSettings = buildSettingsMap();

    for (let i = 0; i < stmts.length; i++) {
      try {
        const r = await executeQuery(stmts[i], pageSize, 0, chSettings, settings.readonly, abortRef.current?.signal);
        allResults.push(r);
        allErrors.push("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") break;
        allResults.push({ columns: [], rows: [], row_count: 0, total_rows: -1, timing_ms: 0, query_id: "" });
        allErrors.push(e instanceof Error ? e.message : "Query failed");
      }
    }

    updateTab(activeTab.id, { results: allResults, errors: allErrors, running: false, resultPage: 0 });
    stopTimer();
    abortRef.current = null;
    if (!allErrors.every((e) => e)) {
      addToHistory(historyInput);
      setQueryHistory(loadHistory());
    }
  }, [activeTab.id, updateTab, startTimer, stopTimer, buildSettingsMap, settings.readonly, pageSize]);

  const loadResultPage = useCallback(async (page: number) => {
    const stmts = activeTab.statements;
    if (!stmts || stmts.length === 0) return;
    updateTab(activeTab.id, { resultPage: page, pageLoading: true });
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const chSettings = buildSettingsMap();
    const offset = page * pageSize;
    const allResults: QueryResult[] = [];
    const allErrors: string[] = [];
    for (let i = 0; i < stmts.length; i++) {
      try {
        const r = await executeQuery(stmts[i], pageSize, offset, chSettings, settings.readonly, abortRef.current?.signal);
        allResults.push(r);
        allErrors.push("");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        allResults.push({ columns: [], rows: [], row_count: 0, total_rows: -1, timing_ms: 0, query_id: "" });
        allErrors.push(e instanceof Error ? e.message : "Query failed");
      }
    }
    updateTab(activeTab.id, { results: allResults, errors: allErrors, pageLoading: false });
    abortRef.current = null;
  }, [activeTab.id, activeTab.statements, updateTab, buildSettingsMap, settings.readonly, pageSize]);

  const runSelection = useCallback(async () => {
    const view = (editorRef.current as { view?: { state: { selection: { main: { from: number; to: number; head: number } }; sliceDoc: (from: number, to: number) => string; doc: { toString: () => string } } } })?.view;
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
          input = input.replace(/(?<!\\)\{\{(\w+)\}\}/g, (m) => {
            placeholders.push(m);
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
  const showSaveDialogRef = useRef(showSaveDialog);
  showSaveDialogRef.current = showSaveDialog;

  const cmKeymap = useMemo(() => Prec.highest(keymap.of([
    { key: "Tab", run: acceptCompletion },
    { key: "Mod-Enter", run: () => { runAllQueriesRef.current(); return true; } },
    { key: "Mod-Shift-Enter", run: () => { runSelectionRef.current(); return true; } },
    { key: "Mod-Shift-f", run: () => { formatSQLRef.current(); return true; } },
    { key: "Alt-Shift-f", run: () => { formatSQLRef.current(); return true; } },
    { key: "Mod-s", run: () => { if (!showSaveDialogRef.current) setShowSaveDialog(true); return true; } },
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
    const view = (editorRef.current as { view?: { state: { selection: { main: { head: number } } }; dispatch: (args: { changes: { from: number; insert: string }; selection: { anchor: number } }) => void; focus: () => void } })?.view;
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
    const newTab = { ...makeEmptyTab(`Query ${tabs.length + 1}`) };
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

  const renameTab = (id: string, name: string) => updateTab(id, { name });

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

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed)) return;
        const valid = parsed.filter(
          (q: { name?: unknown; sql?: unknown }) => q && typeof q.name === "string" && typeof q.sql === "string"
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

  const handleImportParamSets = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed)) return;
        const valid = parsed.filter(
          (s: { name?: unknown; params?: unknown }) => s && typeof s.name === "string" && typeof s.params === "object"
        );
        if (valid.length === 0) return;
        importParamSets(valid);
        setParamSets(loadParamSets());
      } catch {}
    };
    reader.readAsText(file);
  };

  const activeSavedId = savedQueries.find((q) => q.sql === sqlText)?.id;

  const cmTheme = theme === "dark" ? oneDark : undefined;

  const openCount = Object.values(sidebarSections).filter(Boolean).length;

  const makeSectionDrag = (upper: keyof SidebarSections, lower: keyof SidebarSections) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startUpper = sectionHeights[upper];
    const startLower = sectionHeights[lower];
    const sidebarEl = sidebarRef.current;
    if (!sidebarEl) return;
    const headersH = sidebarEl.querySelectorAll('[data-section-header]').length * 33;
    const totalContent = sidebarEl.clientHeight - headersH;
    if (totalContent <= 0) return;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const frac = delta / totalContent;
      let newUpper = Math.max(0.05, Math.min(0.95, startUpper + frac));
      let newLower = startLower - (newUpper - startUpper);
      if (newLower < 0.05) {
        newLower = 0.05;
        newUpper = startUpper + startLower - 0.05;
      }
      setSectionHeights((prev: Record<string, number>) => ({ ...prev, [upper]: newUpper, [lower]: newLower }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const sectionStyle = (key: keyof SidebarSections): React.CSSProperties => {
    if (!sidebarSections[key]) return { height: 0, overflow: "hidden" };
    if (openCount === 0) return { flex: 1, minHeight: 0, overflow: "auto" };
    return { flex: sectionHeights[key] || 0.25, minHeight: 0, overflow: "auto" };
  };

  const onRefreshSchema = () => {
    invalidateSchema();
    setSchemaData({});
    setSchemaStale(false);
    loadDatabases(true);
  };

  // Receive sendToEditor location state
  useEffect(() => {
    const state = location.state as { loadSql?: string; origin?: string } | null;
    if (state?.loadSql) {
      setSQLText(state.loadSql);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate, setSQLText]);

  // Receive snapshot from URL hash (shareable URLs)
  useEffect(() => {
    if (!location.hash) return;
    const snap = readSnapshotFromLocation(location);
    if (snap?.sql) {
      setSQLText(snap.sql);
      if (snap.parameters) {
        setParamValues((prev) => ({ ...prev, ...snap.parameters! }));
      }
      navigate(location.pathname, { replace: true });
    }
  }, [location.hash, location.pathname, navigate, setSQLText]);

  const onSettingsChange = (s: EditorSettings) => setSettings(s);

  if (!connected) return <NotConnectedState />;

  return (
    <div className="flex h-full overflow-hidden">
      <div
        ref={sidebarRef}
        className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--surface-elevated)]"
        style={{ width: sidebarWidth }}
      >
        <SchemaSidebar
          sections={sidebarSections}
          onToggleSection={toggleSection}
          databases={databases}
          schemaData={schemaData}
          schemaLoading={schemaLoading}
          schemaStale={schemaStale}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onInsertAtCursor={insertAtCursor}
          onSetSQLText={setSQLText}
          onRefreshSchema={onRefreshSchema}
          sectionStyle={sectionStyle("schema")}
        />

        <SectionDivider onDrag={makeSectionDrag("schema", "saved")} />

        <SavedQueriesPanel
          sections={sidebarSections}
          onToggleSection={toggleSection}
          savedQueries={savedQueries}
          savedSearch={savedSearch}
          onSavedSearchChange={setSavedSearch}
          activeSQL={sqlText}
          onLoadSaved={handleLoadSaved}
          onDeleteSaved={handleDeleteSaved}
          onOverwriteSaved={handleOverwriteSaved}
          onExport={handleExport}
          onImport={handleImport}
          sectionStyle={sectionStyle("saved")}
        />

        <SectionDivider onDrag={makeSectionDrag("saved", "history")} />

        <HistoryPanel
          sections={sidebarSections}
          onToggleSection={toggleSection}
          history={queryHistory}
          onLoad={(sql) => updateTab(activeTab.id, { sql, results: [], errors: [] })}
          onClear={() => { clearHistory(); setQueryHistory([]); }}
          sectionStyle={sectionStyle("history")}
        />

        <SectionDivider onDrag={makeSectionDrag("history", "params")} />

        <ParametersPanel
          sections={sidebarSections}
          onToggleSection={toggleSection}
          settings={settings}
          onToggleParamsEnabled={(enabled) => setSettings((s) => ({ ...s, enable_params: enabled }))}
          detectedParams={detectedParams}
          paramValues={paramValues}
          onParamValuesChange={setParamValues}
          paramSets={paramSets}
          onSaveParamSet={(name) => { setSavingParamSetName(name); setShowSaveParamSetDialog(true); }}
          onApplyParamSet={handleApplyParamSet}
          onDeleteParamSet={handleDeleteParamSet}
          onExportParamSets={handleExportParamSets}
          onImportParamSets={handleImportParamSets}
          saveDialogOpen={showSaveParamSetDialog}
          savingName={savingParamSetName}
          onSavingNameChange={setSavingParamSetName}
          onSaveDialogClose={() => setShowSaveParamSetDialog(false)}
          onSaveDialogConfirm={handleSaveParamSet}
          sectionStyle={sectionStyle("params")}
        />

        {showSaveDialog && (
          <SaveQueryDialog
            savingName={savingName}
            onNameChange={setSavingName}
            onConfirm={handleSave}
            onCancel={() => setShowSaveDialog(false)}
          />
        )}

        <ConfirmDialog
          open={pendingSql !== null}
          title="Run destructive statement?"
          message={
            <div className="space-y-2">
              <p>This query contains one or more statements that modify data or schema (INSERT, ALTER, DROP, CREATE, TRUNCATE, OPTIMIZE, etc.).</p>
              <p className="text-xs opacity-80">Continue?</p>
            </div>
          }
          confirmLabel="Run anyway"
          confirmVariant="danger"
          onConfirm={() => {
            const sql = pendingSql;
            setPendingSql(null);
            if (sql) {
              const stmts = splitQueries(resolvedSQL(sql));
              executeStatements(stmts, sql);
            }
          }}
          onCancel={() => setPendingSql(null)}
        />
      </div>

      <div
        className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)]"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = sidebarWidth;
          const onMove = (ev: MouseEvent) => {
            const next = Math.max(180, Math.min(600, startWidth + ev.clientX - startX));
            setSidebarWidth(next);
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--color-border)]">
          <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--surface-elevated)] px-2 py-0.5">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`group/tab flex cursor-pointer items-center gap-1 rounded-t px-3 py-1.5 text-xs ${tab.id === activeTabId ? "border-x border-t-2 border-[var(--color-border)] border-b-[var(--surface-base)] -mb-px bg-[var(--surface-base)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
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
                  className="max-w-[120px] truncate outline-none"
                >
                  {tab.name}
                </span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-[var(--surface-hover)] group-hover/tab:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {tab.running && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              </div>
            ))}
            <button
              onClick={addTab}
              className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
              title="New tab"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--surface-elevated)] px-3 py-1.5">
            {activeTab?.running ? (
              <button
                onClick={cancelQuery}
                className="flex items-center gap-1.5 rounded bg-[var(--color-error)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            ) : (
              <button
                onClick={() => runAllQueries()}
                disabled={!sqlText.trim()}
                className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                Run
              </button>
            )}
            <span className="text-[10px] text-[var(--color-text-secondary)]" title="Run all queries">{mod}+Enter</span>
            <span className="text-[10px] text-[var(--color-text-secondary)]" title="Run selection or statement at cursor">/ {mod}+Shift+Enter</span>
            {activeTab?.running && (
              <span className="ml-2 flex items-center gap-1.5 font-mono text-xs text-[var(--color-accent)]">
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
              onClick={() => {
                const params: Record<string, string> = {};
                for (const p of detectedParams) {
                  if (paramValues[p]?.trim()) params[p] = paramValues[p];
                }
                const url = buildShareableUrl({ sql: sqlText, parameters: params, v: 1 });
                copy(url, "Shareable URL copied!");
              }}
              className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              title="Copy shareable URL (encodes SQL in URL hash)"
            >
              <Share2 className="h-3 w-3" />
              Share
            </button>
            <button
              onClick={() => setShowSettings((p) => !p)}
              className={`ml-auto flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs ${showSettings ? "bg-[var(--surface-hover)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
              title="Query settings"
            >
              <Settings2 className="h-3 w-3" />
              Query settings
            </button>
          </div>
          {showSettings && (
            <SettingsBar
              settings={settings}
              onChange={onSettingsChange}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
          )}
          <div style={{ height: editorHeight }}>
            <CodeMirror
              ref={editorRef as React.Ref<never>}
              value={sqlText}
              onChange={setSQLText}
              theme={cmTheme}
              extensions={[cmKeymap, sql({ schema: buildSQLNamespace() })]}
              basicSetup={{ lineNumbers: true, foldGutter: false }}
              className="h-full text-sm [&_.cm-editor]:h-full [&_.cm-scroller]:!font-mono [&_.cm-scroller]:text-[13px]"
            />
          </div>
        </div>

        <div
          className="h-1 shrink-0 cursor-row-resize hover:bg-[var(--color-accent)]"
          title="Drag to resize"
          onMouseDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = editorHeight;
            const onMove = (ev: MouseEvent) => {
              // Leave room for the tabs/toolbar above and a usable results panel below.
              const next = Math.max(120, Math.min(window.innerHeight - 280, startH + ev.clientY - startY));
              setEditorHeight(next);
            };
            const onUp = () => {
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.body.style.cursor = "row-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          }}
        />

        <div className="flex-1 overflow-auto bg-[var(--surface-base)]">
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
                    <div className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--state-error)] px-4 py-3 text-sm text-[var(--color-error)]">
                      {activeTab.errors[i]}
                    </div>
                  ) : (
                    <ResultTable
                      result={result}
                      pageSize={pageSize}
                      resultPage={activeTab.resultPage}
                      pageLoading={activeTab.pageLoading}
                      setResultPage={(fn) => {
                        const next = fn(activeTab.resultPage);
                        loadResultPage(next);
                      }}
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

const DESTRUCTIVE_PREFIXES = [
  "INSERT ", "ALTER ", "DROP ", "CREATE ", "TRUNCATE ", "KILL ",
  "SYSTEM ", "OPTIMIZE ", "DETACH ", "ATTACH ", "RENAME ",
  "GRANT ", "REVOKE ", "DELETE ", "UPDATE ",
];

function hasDestructiveStatement(stmts: string[]): boolean {
  return stmts.some((s) => {
    const upper = s.trimStart().toUpperCase();
    return DESTRUCTIVE_PREFIXES.some((p) => upper.startsWith(p));
  });
}
