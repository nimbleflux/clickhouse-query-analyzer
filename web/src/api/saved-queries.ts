export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  params: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "ch-saved-queries";

const PARAM_REGEX = /(?<!\\)\{\{(\w+)\}\}/g;
const ESCAPED_PARAM_REGEX = /\\\{\{/g;

export function loadSavedQueries(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveSavedQueries(queries: SavedQuery[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
  } catch {}
}

export function addSavedQuery(name: string, sql: string, params: Record<string, string> = {}): SavedQuery {
  const queries = loadSavedQueries();
  const now = Date.now();
  const query: SavedQuery = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    sql,
    params,
    createdAt: now,
    updatedAt: now,
  };
  queries.unshift(query);
  saveSavedQueries(queries);
  return query;
}

export function updateSavedQuery(id: string, updates: Partial<Pick<SavedQuery, "name" | "sql" | "params">>): SavedQuery | null {
  const queries = loadSavedQueries();
  const idx = queries.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  queries[idx] = { ...queries[idx], ...updates, updatedAt: Date.now() };
  saveSavedQueries(queries);
  return queries[idx];
}

export function importSavedQueries(incoming: SavedQuery[]): { added: number; skipped: number } {
  const existing = loadSavedQueries();
  const existingNames = new Set(existing.map((q) => q.name));
  let added = 0;
  let skipped = 0;
  for (const q of incoming) {
    if (existingNames.has(q.name)) {
      skipped++;
      continue;
    }
    const now = Date.now();
    existing.unshift({
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      name: q.name,
      sql: q.sql,
      params: q.params || {},
      createdAt: q.createdAt || now,
      updatedAt: q.updatedAt || now,
    });
    existingNames.add(q.name);
    added++;
  }
  saveSavedQueries(existing);
  return { added, skipped };
}

export function deleteSavedQuery(id: string): boolean {
  const queries = loadSavedQueries();
  const filtered = queries.filter((q) => q.id !== id);
  if (filtered.length === queries.length) return false;
  saveSavedQueries(filtered);
  return true;
}

export function detectParams(sql: string): string[] {
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(PARAM_REGEX.source, "g");
  while ((match = regex.exec(sql)) !== null) {
    seen.add(match[1]);
  }
  return Array.from(seen);
}

export function resolveParams(sql: string, values: Record<string, string>): string {
  let result = sql.replace(PARAM_REGEX, (_match, paramName: string) => {
    const val = values[paramName];
    return val !== undefined ? val : `{{${paramName}}}`;
  });
  result = result.replace(ESCAPED_PARAM_REGEX, "{{");
  return result;
}

export interface ParamSet {
  id: string;
  name: string;
  params: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

const PARAM_SETS_KEY = "ch-param-sets";

export function loadParamSets(): ParamSet[] {
  try {
    const raw = localStorage.getItem(PARAM_SETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveParamSets(sets: ParamSet[]): void {
  try {
    localStorage.setItem(PARAM_SETS_KEY, JSON.stringify(sets));
  } catch {}
}

export function addParamSet(name: string, params: Record<string, string>): ParamSet {
  const sets = loadParamSets();
  const now = Date.now();
  const set: ParamSet = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    params,
    createdAt: now,
    updatedAt: now,
  };
  sets.unshift(set);
  saveParamSets(sets);
  return set;
}

export function updateParamSet(id: string, updates: Partial<Pick<ParamSet, "name" | "params">>): ParamSet | null {
  const sets = loadParamSets();
  const idx = sets.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  sets[idx] = { ...sets[idx], ...updates, updatedAt: Date.now() };
  saveParamSets(sets);
  return sets[idx];
}

export function deleteParamSet(id: string): boolean {
  const sets = loadParamSets();
  const filtered = sets.filter((s) => s.id !== id);
  if (filtered.length === sets.length) return false;
  saveParamSets(filtered);
  return true;
}

export function importParamSets(incoming: ParamSet[]): { added: number; skipped: number } {
  const existing = loadParamSets();
  const existingNames = new Set(existing.map((s) => s.name));
  let added = 0;
  let skipped = 0;
  for (const s of incoming) {
    if (existingNames.has(s.name)) {
      skipped++;
      continue;
    }
    const now = Date.now();
    existing.unshift({
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      name: s.name,
      params: s.params || {},
      createdAt: s.createdAt || now,
      updatedAt: s.updatedAt || now,
    });
    existingNames.add(s.name);
    added++;
  }
  saveParamSets(existing);
  return { added, skipped };
}
