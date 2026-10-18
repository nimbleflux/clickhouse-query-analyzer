import { useState } from "react";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatBytes, formatDuration, formatNumber } from "@/utils";
import type { QueryLogEntry, MetricPoint } from "@/api/types";
import type { ApiError } from "@/api/errors";
import { ErrorState } from "@/components/ui/state";
import { useChartTheme } from "@/hooks/useChartTheme";
import { ChartSection, SettingHint, computeMetricDeltas, getTopProfileEvents, tooltipFmt, labelFmt, TOOLTIP_STYLE } from "./shared";
import { QueryMetadataCard } from "./QueryMetadataCard";

interface OverviewTabProps {
  query: QueryLogEntry;
  metrics: MetricPoint[];
  /** Set when the metrics fetch failed; renders an ErrorState instead of the "no data" hint. */
  metricsError?: ApiError | null;
  onRetryMetrics?: () => void;
}

export function OverviewTab({ query, metrics, metricsError, onRetryMetrics }: OverviewTabProps) {
  const [profileEventFilter, setProfileEventFilter] = useState("");
  const { gridColor, series } = useChartTheme();
  // series = [accent, violet, error, warning, success, cyan, pink, orange]
  const [accent, violet, error, warning, success] = series;
  const metricData = computeMetricDeltas(metrics);
  const topEvents = getTopProfileEvents(query.profile_events);

  return (
    <div className="space-y-6">
      <QueryMetadataCard query={query} />

      {metricData.length > 1 ? (
        <>
          <ChartSection title="Memory Usage Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={metricData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" />
                <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={labelFmt((l) => `Time: ${l}`)}
                  formatter={tooltipFmt(formatBytes)}
                />
                <Area type="monotone" dataKey="memory" stroke={accent} fill={`${accent}80`} name="Memory" />
                <Area type="monotone" dataKey="peak" stroke={violet} fill={`${violet}40`} name="Peak" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartSection>

          <ChartSection title="CPU Time Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={metricData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" />
                <YAxis tickFormatter={(v: number) => formatDuration(v / 1000)} tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={labelFmt((l) => `Time: ${l}`)}
                  formatter={tooltipFmt((v) => formatDuration(v / 1000))}
                />
                <Area type="monotone" dataKey="userTime" stroke={success} fill={`${success}40`} name="User CPU" />
                <Area type="monotone" dataKey="systemTime" stroke={warning} fill={`${warning}40`} name="System CPU" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartSection>

          <ChartSection title="I/O Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={metricData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" />
                <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={labelFmt((l) => `Time: ${l}`)}
                  formatter={tooltipFmt(formatBytes)}
                />
                <Area type="monotone" dataKey="readBytes" stroke={accent} fill={`${accent}40`} name="Disk Read" />
                <Area type="monotone" dataKey="writeBytes" stroke={error} fill={`${error}40`} name="Disk Write" />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </ChartSection>

          <ChartSection title="Network Over Time">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={metricData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" />
                <YAxis tickFormatter={(v: number) => formatBytes(v)} tick={{ fontSize: 11 }} stroke="var(--color-text-secondary)" width={80} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={labelFmt((l) => `Time: ${l}`)}
                  formatter={tooltipFmt(formatBytes)}
                />
                <Line type="monotone" dataKey="netRecv" stroke={success} name="Received" dot={false} />
                <Line type="monotone" dataKey="netSend" stroke={violet} name="Sent" dot={false} />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </ChartSection>
        </>
      ) : metricsError ? (
        <ErrorState
          error={metricsError}
          title="Failed to load metrics"
          onRetry={onRetryMetrics}
        />
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
          No time-series metric data available for this query.
          <br />
          <span className="text-xs">This may be because query_metric_log is not enabled or the query was too fast to sample.</span>
          <SettingHint settings={query.settings} settingKey="log_queries" label="log_queries" />
        </div>
      )}

      {topEvents.length > 0 && (
        <ChartSection title="Top Profile Events">
          <div className="mb-2">
            <input
              type="text"
              value={profileEventFilter}
              onChange={(e) => setProfileEventFilter(e.target.value)}
              placeholder="Filter events..."
              className="w-full rounded border border-[var(--color-border)] bg-[var(--surface-base)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Event</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Value</th>
                  <th className="px-4 py-2 text-right font-medium text-[var(--color-text-secondary)]">Category</th>
                </tr>
              </thead>
              <tbody>
                {topEvents
                  .filter(([name]) => !profileEventFilter || name.toLowerCase().includes(profileEventFilter.toLowerCase()))
                  .map(([name, value, cat]) => (
                  <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{formatNumber(value)}</td>
                    <td className="px-4 py-2 text-right text-xs text-[var(--color-text-secondary)]">{cat}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartSection>
      )}
    </div>
  );
}
