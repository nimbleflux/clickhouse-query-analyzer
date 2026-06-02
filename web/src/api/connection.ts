export interface ConnectionParams {
  url: string;
  user: string;
  password: string;
  database: string;
  skip_tls: boolean;
  readonly: boolean;
}

const STORAGE_KEY = "ch-query-analyzer-connection";

export const DEFAULT_CONNECTION: ConnectionParams = {
  url: "clickhouse://localhost:9000",
  user: "default",
  password: "",
  database: "system",
  skip_tls: false,
  readonly: false,
};

export function loadConnection(): ConnectionParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONNECTION, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_CONNECTION };
}

export function saveConnection(params: ConnectionParams): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
}

function initHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = { ...DEFAULT_CONNECTION, ...JSON.parse(raw) } as ConnectionParams;
      return {
        "X-CH-URL": p.url || "",
        "X-CH-User": p.user || "",
        "X-CH-Password": p.password || "",
        "X-CH-Database": p.database || "",
        "X-CH-Skip-TLS": p.skip_tls ? "1" : "0",
      };
    }
  } catch { /* ignore */ }
  return {};
}

let currentHeaders: Record<string, string> = initHeaders();

export function setConnectionHeaders(params: ConnectionParams): void {
  currentHeaders = {
    "X-CH-URL": params.url,
    "X-CH-User": params.user,
    "X-CH-Password": params.password,
    "X-CH-Database": params.database,
    "X-CH-Skip-TLS": params.skip_tls ? "1" : "0",
  };
  saveConnection(params);
}

export function getConnectionHeaders(): Record<string, string> {
  return currentHeaders;
}

export function clearConnectionHeaders(): void {
  currentHeaders = {};
}
