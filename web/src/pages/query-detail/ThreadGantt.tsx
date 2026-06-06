import { useMemo } from "react";
import type { ThreadEntry } from "@/api/types";
import { ChartSection } from "./shared";
import { formatDuration, formatBytes } from "@/utils";

interface ThreadGanttProps {
  threads: ThreadEntry[];
}

interface GanttRow {
  threadId: number;
  threadName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  peakMemory: number;
  readBytes: number;
  readRows: number;
}

const ROLE_COLORS: Record<string, string> = {
  "Coordinator": "bg-[var(--color-accent)]",
  "Scan": "bg-emerald-500",
  "Reader": "bg-emerald-500",
  "Aggregator": "bg-purple-500",
  "Filter": "bg-amber-500",
  "MergeTree": "bg-sky-500",
  "I/O": "bg-orange-500",
  "Pipeline": "bg-indigo-500",
  "Writer": "bg-rose-500",
};

function classifyThread(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("coordinator") || lower.includes("master")) return "Coordinator";
  if (lower.includes("scan") || lower.includes("read") || lower.includes("mergetree")) return "Scan";
  if (lower.includes("aggreg")) return "Aggregator";
  if (lower.includes("filter")) return "Filter";
  if (lower.includes("merge") && !lower.includes("mergetree")) return "Aggregator";
  if (lower.includes("io") || lower.includes("pool")) return "I/O";
  if (lower.includes("pipeline")) return "Pipeline";
  if (lower.includes("write")) return "Writer";
  return "Other";
}

function colorFor(role: string): string {
  return ROLE_COLORS[role] || "bg-[var(--color-text-secondary)]";
}

export function ThreadGantt({ threads }: ThreadGanttProps) {
  const rows = useMemo<GanttRow[]>(() => {
    if (threads.length === 0) return [];
    const sorted = [...threads].sort((a, b) => {
      const aStart = new Date(a.event_time).getTime();
      const bStart = new Date(b.event_time).getTime();
      if (aStart !== bStart) return aStart - bStart;
      return b.query_duration_ms - a.query_duration_ms;
    });
    return sorted.map((t) => {
      const start = new Date(t.event_time).getTime();
      return {
        threadId: t.thread_id,
        threadName: t.thread_name,
        startMs: start,
        endMs: start + t.query_duration_ms,
        durationMs: t.query_duration_ms,
        peakMemory: t.peak_memory_usage,
        readBytes: t.read_bytes,
        readRows: t.read_rows,
      };
    });
  }, [threads]);

  if (rows.length === 0) return null;

  const minStart = Math.min(...rows.map((r) => r.startMs));
  const maxEnd = Math.max(...rows.map((r) => r.endMs));
  const totalSpan = Math.max(1, maxEnd - minStart);
  const bucketSize = Math.max(1, Math.floor(rows.length / 30));

  const visibleRows = rows.slice(0, 100);
  const maxDuration = Math.max(...visibleRows.map((r) => r.durationMs));

  const formatOffset = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return formatDuration(ms);
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <ChartSection title={`Thread Timeline (Gantt) — ${rows.length} thread${rows.length > 1 ? "s" : ""}${rows.length > 100 ? ` (showing first 100)` : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] text-[var(--color-text-secondary)]">
        {Object.entries(ROLE_COLORS).map(([role, cls]) => (
          <span key={role} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${cls}`} />
            {role}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="mb-1 ml-44 flex justify-between border-b border-[var(--color-border)] pb-0.5 text-[10px] text-[var(--color-text-secondary)]">
            <span>0</span>
            <span>{formatOffset(totalSpan / 4)}</span>
            <span>{formatOffset(totalSpan / 2)}</span>
            <span>{formatOffset((totalSpan * 3) / 4)}</span>
            <span>{formatOffset(totalSpan)}</span>
          </div>
          <div className="space-y-0.5">
            {visibleRows.map((row, idx) => {
              const role = classifyThread(row.threadName);
              const cls = colorFor(role);
              const startPct = ((row.startMs - minStart) / totalSpan) * 100;
              const widthPct = Math.max(0.1, ((row.endMs - row.startMs) / totalSpan) * 100);
              const intensity = Math.max(0.3, Math.min(1, row.durationMs / maxDuration));
              const isBucketStart = idx % bucketSize === 0;
              return (
                <div key={`${row.threadId}-${idx}`} className="group flex items-center gap-2">
                  <div
                    className="w-44 shrink-0 truncate text-right font-mono text-[10px] text-[var(--color-text-secondary)]"
                    title={`${row.threadName} (id=${row.threadId})`}
                  >
                    {isBucketStart || row.durationMs > maxDuration * 0.5 ? row.threadName : ""}
                  </div>
                  <div className="relative h-3 flex-1 rounded-sm bg-[var(--surface-elevated)]">
                    <div
                      className={`absolute top-0 h-3 rounded-sm ${cls}`}
                      style={{
                        left: `${startPct}%`,
                        width: `${widthPct}%`,
                        opacity: intensity,
                      }}
                      title={`${row.threadName}
duration: ${formatDuration(row.durationMs)}
peak memory: ${formatBytes(row.peakMemory)}
read: ${formatBytes(row.readBytes)} (${row.readRows} rows)`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-[var(--color-text-secondary)] opacity-70">
        Bar width = wall-clock duration · Bar intensity = relative duration · Hover for details
      </div>
    </ChartSection>
  );
}
