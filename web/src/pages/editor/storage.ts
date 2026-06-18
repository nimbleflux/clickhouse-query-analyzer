import type { QueryResult } from "@/api/types";

export interface EditorTab {
  id: string;
  name: string;
  sql: string;
  results: QueryResult[];
  errors: string[];
  running: boolean;
  resultPage: number;
  paramValues: Record<string, string>;
  statements?: string[];
  pageLoading?: boolean;
}

export interface SidebarSections {
  schema: boolean;
  saved: boolean;
  history: boolean;
  params: boolean;
}

export interface HistoryEntry {
  sql: string;
  timestamp: string;
}

export type SettingsKey =
  | "log_queries"
  | "log_query_threads"
  | "log_profile_events"
  | "query_profiler_real_time_period_ns"
  | "query_profiler_cpu_time_period_ns"
  | "allow_introspection_functions"
  | "enable_params"
  | "readonly";

export type EditorSettings = Record<SettingsKey, boolean>;

export const TABS_KEY = "ch-editor-tabs";
export const ACTIVE_TAB_KEY = "ch-editor-active-tab";
export const PAGE_SIZE_KEY = "ch-editor-page-size";
export const SETTINGS_KEY = "ch-editor-settings";
export const SIDEBAR_SECTIONS_KEY = "ch-editor-sidebar-sections";
export const HISTORY_KEY = "ch-editor-history";
export const MAX_HISTORY = 100;

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function makeEmptyTab(name = "Query 1"): EditorTab {
  return {
    id: uid(),
    name,
    sql: "SELECT ",
    results: [],
    errors: [],
    running: false,
    resultPage: 0,
    paramValues: {},
  };
}

export function loadTabs(): EditorTab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [makeEmptyTab()];
}

export function saveTabs(tabs: EditorTab[]) {
  const serializable = tabs.map((t) => ({ ...t, results: [], errors: [], running: false }));
  try { localStorage.setItem(TABS_KEY, JSON.stringify(serializable)); } catch {}
}

export function loadSettings(): EditorSettings {
  const defaults: EditorSettings = {
    log_queries: true,
    log_query_threads: true,
    log_profile_events: true,
    query_profiler_real_time_period_ns: true,
    query_profiler_cpu_time_period_ns: true,
    allow_introspection_functions: true,
    enable_params: true,
    readonly: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

export function saveSettings(s: EditorSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export function loadSidebarSections(): SidebarSections {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { history: false, ...parsed };
    }
  } catch {}
  return { schema: true, saved: false, history: false, params: true };
}

export function saveSidebarSections(s: SidebarSections) {
  try { localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(s)); } catch {}
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function addToHistory(sql: string) {
  const trimmed = sql.trim();
  if (!trimmed) return;
  const history = loadHistory();
  if (history.length > 0 && history[0].sql === trimmed) return;
  history.unshift({ sql: trimmed, timestamp: new Date().toISOString() });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); } catch {}
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}
