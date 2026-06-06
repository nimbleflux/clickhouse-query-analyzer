import type { ReactNode } from "react";
import { formatBytes, formatDuration, formatNumber } from "@/utils";

export function ChartSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
      <h3 className="mb-4 text-sm font-medium text-[var(--color-text-secondary)]">{title}</h3>
      {children}
    </div>
  );
}

export function MetricCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
      <div className="mb-1 flex items-center gap-2 text-[var(--color-text-secondary)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={`text-lg font-semibold ${color || "text-[var(--color-text-primary)]"}`}>{value}</div>
    </div>
  );
}

export function settingEnabled(settings: Record<string, string> | undefined, key: string): boolean {
  if (!settings) return false;
  const v = settings[key];
  return v !== undefined && v !== "0";
}

export function SettingHint({ settings, settingKey, label }: { settings: Record<string, string> | undefined; settingKey: string; label: string }) {
  if (settingEnabled(settings, settingKey)) return null;
  return (
    <p className="mt-2 text-xs text-[var(--color-warning)]">
      {label} was disabled for this query. Re-run with it enabled in the SQL Editor&apos;s Settings panel for richer data.
    </p>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tooltipFmt(fn: (v: number) => string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (value: any) => fn(Number(value));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function labelFmt(fn: (l: string) => string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (label: any) => fn(String(label));
}

export const TOOLTIP_STYLE = {
  backgroundColor: "var(--surface-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

export interface MetricDelta {
  time: string;
  memory: number;
  peak: number;
  userTime: number;
  systemTime: number;
  readBytes: number;
  writeBytes: number;
  netRecv: number;
  netSend: number;
}

import type { MetricPoint } from "@/api/types";

export function computeMetricDeltas(points: MetricPoint[]): MetricDelta[] {
  if (points.length === 0) return [];
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1] : p;
    const t = new Date(p.event_time);
    const time = t.toLocaleTimeString();
    return {
      time,
      memory: p.memory_usage,
      peak: p.peak_memory_usage,
      userTime: Math.max(0, p.user_time_microseconds - prev.user_time_microseconds),
      systemTime: Math.max(0, p.system_time_microseconds - prev.system_time_microseconds),
      readBytes: Math.max(0, p.read_bytes - prev.read_bytes),
      writeBytes: Math.max(0, p.write_bytes - prev.write_bytes),
      netRecv: Math.max(0, p.network_receive_bytes - prev.network_receive_bytes),
      netSend: Math.max(0, p.network_send_bytes - prev.network_send_bytes),
    };
  });
}

import { categorizeEvent } from "@/utils";

export function getTopProfileEvents(events: Record<string, number>): [string, number, string][] {
  return Object.entries(events)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([name, value]) => [name, value, categorizeEvent(name)]);
}

export const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#ec4899", "#f97316"];

export function extractMemoryCategories(events: Record<string, number>): { name: string; value: number; count: number }[] {
  const categoryMap = new Map<string, { value: number; count: number }>();
  const memEvents: [string, string][] = [
    ["ArenaAllocBytes", "Arena"],
    ["ArenaAllocCount", "Arena"],
    ["CacheBytesReadFromFilesystem", "Filesystem Cache"],
    ["CacheBytesWriteToFilesystem", "Filesystem Cache"],
    ["CachedReadBufferCacheWriteBytes", "Cache Writes"],
    ["MarkCacheHits", "Mark Cache"],
    ["MarkCacheMisses", "Mark Cache"],
    ["PrimaryKeyCacheHits", "PK Cache"],
    ["PrimaryKeyCacheMisses", "PK Cache"],
    ["CompressedReadBufferBytes", "Compressed Reads"],
    ["UncompressedReadBufferBytes", "Uncompressed Reads"],
    ["ReadBufferFromS3Bytes", "S3 I/O"],
    ["ReadBufferFromAzureBytes", "Azure I/O"],
    ["NetworkReceiveBytes", "Network Recv"],
    ["NetworkSendBytes", "Network Send"],
    ["IOBufferAllocBytes", "I/O Buffers"],
    ["IOBufferAllocCount", "I/O Buffers"],
    ["MemoryAllocatorAllocBytes", "Allocator"],
    ["MemoryAllocatorDeallocBytes", "Allocator"],
    ["MemoryTrackingAllocated", "Tracked Alloc"],
    ["MemoryTrackingFreed", "Tracked Free"],
    ["QueryMemoryLimit", "Query Limit"],
    ["ExternalSortingUncompressedBytes", "External Sort"],
    ["ExternalAggregationUncompressedBytes", "External Agg"],
    ["GrpcClients", "gRPC"],
    ["HTTPConnection", "HTTP"],
    ["InterserverConnection", "Interserver"],
    ["MySQLConnection", "MySQL"],
    ["NaturalEqual", "JOIN Memory"],
    ["NaturalIf", "JOIN Memory"],
  ];

  for (const [eventKey, category] of memEvents) {
    const val = events[eventKey] || events[`ProfileEvent_${eventKey}`] || 0;
    if (val > 0) {
      const existing = categoryMap.get(category) || { value: 0, count: 0 };
      categoryMap.set(category, {
        value: existing.value + val,
        count: existing.count + 1,
      });
    }
  }

  return Array.from(categoryMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value);
}

export function parsePipeline(pipelineStr: string): { name: string; count: number }[] {
  const steps: { name: string; count: number }[] = [];
  const seen = new Set<string>();
  for (const line of pipelineStr.split("\n")) {
    const trimmed = line.replace(/[()×→\d\s]+/g, " ").trim();
    const match = trimmed.match(/^(?:\((\w+)\)\s*)?(\w+)(?:\s.*×(\d+))?/);
    if (!match) continue;
    const stepName = match[1] || match[2];
    const count = match[3] ? parseInt(match[3]) : 1;
    if (!seen.has(stepName)) {
      seen.add(stepName);
      steps.push({ name: stepName, count });
    }
  }
  return steps;
}

export const KEY_PROFILE_EVENTS: [string, string, (v: number) => string][] = [
  ["SelectedRows", "Rows Selected", (v) => formatNumber(v)],
  ["RowsReadByMainReader", "Rows Read (Main)", (v) => formatNumber(v)],
  ["FilterTransformPassedRows", "Rows Passed Filter", (v) => formatNumber(v)],
  ["ReadCompressedBytes", "Compressed Read", (v) => formatBytes(v)],
  ["CompressedReadBufferBytes", "Decompressed Bytes", (v) => formatBytes(v)],
  ["DiskReadElapsedMicroseconds", "Disk Read Time", (v) => formatDuration(v / 1000)],
  ["SynchronousReadWaitMicroseconds", "Sync Read Wait", (v) => formatDuration(v / 1000)],
  ["IOBufferAllocBytes", "I/O Buffer Alloc", (v) => formatBytes(v)],
  ["ArenaAllocBytes", "Arena Alloc", (v) => formatBytes(v)],
  ["UserTimeMicroseconds", "User CPU Time", (v) => formatDuration(v / 1000)],
  ["SystemTimeMicroseconds", "System CPU Time", (v) => formatDuration(v / 1000)],
  ["RealTimeMicroseconds", "Wall Clock Time", (v) => formatDuration(v / 1000)],
  ["OSCPUWaitMicroseconds", "CPU Wait", (v) => formatDuration(v / 1000)],
  ["NetworkSendBytes", "Network Sent", (v) => formatBytes(v)],
  ["MarkCacheHits", "Mark Cache Hits", (v) => formatNumber(v)],
  ["MarkCacheMisses", "Mark Cache Misses", (v) => formatNumber(v)],
  ["CreatedReadBufferOrdinary", "Read Buffers Created", (v) => v.toString()],
  ["FileOpen", "Files Opened", (v) => v.toString()],
  ["QueryPlanOptimizeMicroseconds", "Plan Optimization", (v) => formatDuration(v / 1000)],
];
