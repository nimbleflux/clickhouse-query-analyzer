export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms === 0) return "0ms";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const min = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${min}m ${sec}s`;
}

/**
 * Canonical byte formatter for the whole app: binary units (1024 division)
 * with a single decimal, e.g. 512.0 B / 1.0 KB / 1.0 MB / 1.0 GB / 1.0 TB.
 * (The labels say KB/MB but the math is binary — this is the historical
 * behavior of the monitoring pages and is kept as-is on purpose.)
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  const abs = Math.abs(bytes);
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(abs) / Math.log(k));
  const formatted = (abs / Math.pow(k, i)).toFixed(1);
  return bytes < 0 ? `-${formatted} ${sizes[i]}` : `${formatted} ${sizes[i]}`;
}

export function formatNumber(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return n.toFixed(0);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

/**
 * Locale-aware date + time for log timestamps ("when did this run?").
 * Parses both ISO strings and ClickHouse's "YYYY-MM-DD HH:MM:SS" (normalized
 * to ISO so every browser treats it as local time). The year is included only
 * when the timestamp is not in the current year, so recent queries stay
 * compact ("Jan 5, 14:03:22") while old ones stay unambiguous
 * ("Dec 24, 2024, 09:12:45"). Unparseable input is returned unchanged.
 */
export function formatDateTime(s: string): string {
  if (!s) return "";
  const normalized = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return s;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(
    undefined,
    sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" },
  );
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date}, ${time}`;
}

/**
 * @deprecated Use {@link formatDateTime} instead — this fixed MM/DD HH:MM:SS
 * format is US-only and drops the year. Kept only for files outside the
 * ux-consistency refactor's scope that still render it.
 */
export function formatTime(ts: string): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

export function durationColor(ms: number): string {
  if (ms < 100) return "text-[var(--color-success)]";
  if (ms < 1000) return "text-[var(--color-warning)]";
  return "text-[var(--color-error)]";
}

export function memoryColor(bytes: number): string {
  if (bytes < 10 * 1024 * 1024) return "text-[var(--color-success)]";
  if (bytes < 100 * 1024 * 1024) return "text-[var(--color-warning)]";
  return "text-[var(--color-error)]";
}

const EVENT_CATEGORIES: [RegExp, string][] = [
  [/Time|TimeMicroseconds|Clock|CPU/, "CPU"],
  [/Disk|Read|Write|IO|File|Compress/, "I/O"],
  [/Memory|Alloc|Arena/, "Memory"],
  [/Network|Send|Receive|Socket/, "Network"],
  [/Cache|Hit|Miss/, "Cache"],
];

export function categorizeEvent(name: string): string {
  for (const [re, cat] of EVENT_CATEGORIES) {
    if (re.test(name)) return cat;
  }
  return "Other";
}

export type QueryStatusVariant = "success" | "warning" | "error" | "outline";

export interface QueryStatus {
  label: string;
  variant: QueryStatusVariant;
}

export function queryStatus(type: string): QueryStatus {
  switch (type) {
    case "QueryStart":
      return { label: "Running", variant: "warning" };
    case "QueryFinish":
      return { label: "Complete", variant: "success" };
    case "ExceptionBeforeStart":
    case "ExceptionWhileProcessing":
      return { label: "Exception", variant: "error" };
    default:
      return { label: type, variant: "outline" };
  }
}

export function isException(type: string): boolean {
  return type === "ExceptionBeforeStart" || type === "ExceptionWhileProcessing";
}
