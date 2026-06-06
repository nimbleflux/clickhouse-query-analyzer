import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { formatBytes, formatNumber, memoryColor } from "@/utils";
import type { QueryLogEntry, MetricPoint } from "@/api/types";
import { ChartSection, SettingHint, extractMemoryCategories, PIE_COLORS, tooltipFmt, TOOLTIP_STYLE } from "./shared";

interface MemoryTabProps {
  query: QueryLogEntry;
  metrics: MetricPoint[];
}

export function MemoryTab({ query, metrics }: MemoryTabProps) {
  const memCategories = extractMemoryCategories(query.profile_events);

  const memOverTime = metrics.length > 1
    ? metrics.map((m) => ({
        time: new Date(m.event_time).toLocaleTimeString(),
        memory: m.memory_usage,
        peak: m.peak_memory_usage,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-secondary)]">Peak Memory Usage</div>
          <div className={`text-2xl font-bold ${memoryColor(query.memory_usage)}`}>
            {formatBytes(query.memory_usage)}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-secondary)]">Data Read into Memory</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatBytes(query.read_bytes)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {formatNumber(query.read_rows)} rows
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-secondary)]">Memory Profile</div>
          <div className="text-sm text-[var(--color-text-primary)]">
            {memCategories.length > 0 ? `${memCategories.length} categories` : "No categories"}
          </div>
        </div>
      </div>

      {memOverTime.length > 1 && (
        <ChartSection title="Memory Usage Over Time">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={memOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" />
              <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" width={80} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={tooltipFmt(formatBytes)}
              />
              <Area type="monotone" dataKey="memory" stroke="#3b82f6" fill="#3b82f680" name="Current" />
              <Area type="monotone" dataKey="peak" stroke="#8b5cf6" fill="#8b5cf640" name="Peak" />
              <Legend />
            </AreaChart>
          </ResponsiveContainer>
        </ChartSection>
      )}

      {memCategories.length > 0 && (
        <ChartSection title="Memory by Category">
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="w-full shrink-0 sm:w-64">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={memCategories}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {memCategories.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={tooltipFmt(formatBytes)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Bytes</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {memCategories.map((c, i) => (
                    <tr key={c.name} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        {c.name}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatBytes(c.value)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-[var(--color-text-secondary)]">{formatNumber(c.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ChartSection>
      )}

      {memCategories.length === 0 && memOverTime.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
          No detailed memory data available.
          <br />
          <span className="text-xs">
            Requires <code className="rounded bg-[var(--surface-base)] px-1">query_metric_log</code> enabled in ClickHouse config
            and <code className="rounded bg-[var(--surface-base)] px-1">log_queries</code> enabled at query time.
          </span>
          <SettingHint settings={query.settings} settingKey="log_queries" label="log_queries" />
        </div>
      )}
    </div>
  );
}
