import { invalidateSchema } from "./schema-cache";

export interface ConnectionParams {
  url: string;
  user: string;
  password: string;
  database: string;
  skip_tls: boolean;
  readonly: boolean;
}

const STORAGE_KEY = "ch-query-analyzer-connection";
// The password never touches localStorage (plaintext on disk). It lives in
// sessionStorage instead: a page refresh within the tab keeps it, closing the
// tab (or Disconnect) clears it.
const SESSION_PASSWORD_KEY = "ch-query-analyzer-password";

export const DEFAULT_CONNECTION: ConnectionParams = {
  url: "clickhouse://localhost:9000",
  user: "default",
  password: "",
  database: "system",
  skip_tls: false,
  readonly: false,
};

function loadSessionPassword(): string {
  try {
    return sessionStorage.getItem(SESSION_PASSWORD_KEY) || "";
  } catch {
    return "";
  }
}

export function loadConnection(): ConnectionParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge order matters: the persisted password field of older entries is
      // always overridden — the session is the only password source.
      return { ...DEFAULT_CONNECTION, ...parsed, password: loadSessionPassword() };
    }
  } catch {}
  return { ...DEFAULT_CONNECTION };
}

export function saveConnection(params: ConnectionParams): void {
  // Everything except the password persists; the password goes to sessionStorage.
  const persisted = {
    url: params.url,
    user: params.user,
    database: params.database,
    skip_tls: params.skip_tls,
    readonly: params.readonly,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  try { sessionStorage.setItem(SESSION_PASSWORD_KEY, params.password); } catch {}
}

function headersFor(p: ConnectionParams): Record<string, string> {
  return {
    "X-CH-URL": p.url || "",
    "X-CH-User": p.user || "",
    "X-CH-Password": p.password || "",
    "X-CH-Database": p.database || "",
    "X-CH-Skip-TLS": p.skip_tls ? "1" : "0",
  };
}

function initHeaders(): Record<string, string> {
  try {
    // Headers are only primed when the user has a saved connection — an
    // untouched install must not send DEFAULT_CONNECTION to the backend.
    if (!localStorage.getItem(STORAGE_KEY)) return {};
    return headersFor(loadConnection());
  } catch { /* ignore */ }
  return {};
}

let currentHeaders: Record<string, string> = initHeaders();

export function setConnectionHeaders(params: ConnectionParams): void {
  currentHeaders = headersFor(params);
  saveConnection(params);
  // The schema cache belongs to the previous server/database — drop it so the
  // sidebar refetches for the new connection instead of showing stale tables.
  invalidateSchema();
}

export function getConnectionHeaders(): Record<string, string> {
  return currentHeaders;
}

export function clearConnectionHeaders(): void {
  currentHeaders = {};
  try { sessionStorage.removeItem(SESSION_PASSWORD_KEY); } catch {}
}
