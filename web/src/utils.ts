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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatNumber(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return n.toFixed(0);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

export function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString();
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
