import { FlameGraph } from "@/components/FlameGraph";
import { ChartSection, SettingHint } from "./shared";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/state";
import type { FlameGraphData, QueryLogEntry } from "@/api/types";
import type { ApiError } from "@/api/errors";

interface FlamegraphTabProps {
  flameData: FlameGraphData[];
  flameError: ApiError | null;
  flameLoading: boolean;
  query: QueryLogEntry;
  onSelectType: (type: string) => void;
  activeType?: string;
}

const TRACE_TYPES = [
  { key: "MemorySample", label: "Memory (Sampled)" },
  { key: "Memory", label: "Memory (Alloc)" },
  { key: "MemoryPeak", label: "Memory (Peak)" },
  { key: "Real", label: "Real Time" },
  { key: "CPU", label: "CPU Time" },
];

export function FlamegraphTab({ flameData, flameError, flameLoading, query, onSelectType, activeType = "Real" }: FlamegraphTabProps) {
  const isTraceLogMissing = flameError !== null
    && flameError.message.toLowerCase().includes("trace_log")
    && flameError.isClickHouseError();
  const isRunning = query.type === "QueryStart";
  const hasData = flameData.length > 0;

  return (
    <ChartSection title="Flame Graph">
      <div className="mb-3 flex flex-wrap gap-2">
        {TRACE_TYPES.map((t) => (
          <Button
            key={t.key}
            variant="secondary"
            size="sm"
            active={activeType === t.key}
            onClick={() => onSelectType(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {flameLoading ? (
        <LoadingState message="Loading trace data..." />
      ) : hasData ? (
        <FlameGraph data={flameData} />
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-6 text-center text-sm text-[var(--color-text-secondary)]">
          {isTraceLogMissing ? (
            <>
              <p className="font-medium text-[var(--color-warning)]">trace_log is not enabled on this ClickHouse server</p>
              <p className="mt-2 text-xs opacity-80">
                Add the following to your <code className="rounded bg-[var(--surface-base)] px-1">config.xml</code>:
              </p>
              <pre className="mt-2 inline-block rounded bg-[var(--surface-base)] px-3 py-2 text-left font-mono text-xs text-[var(--color-text-primary)]">
{`<trace_log>
    <database>system</database>
    <table>trace_log</table>
    <flush_interval_milliseconds>1000</flush_interval_milliseconds>
</trace_log>`}
              </pre>
              <p className="mt-2 text-xs opacity-80">
                Then enable sampling profilers in the SQL Editor Settings panel (real_time_profiler, cpu_profiler).
              </p>
            </>
          ) : flameError ? (
            <>
              <p className="font-medium text-[var(--color-error)]">{flameError.message}</p>
              {flameError.hint && (
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{flameError.hint}</p>
              )}
            </>
          ) : isRunning ? (
            <>
              <p className="font-medium text-[var(--color-warning)]">Query still running</p>
              <p className="mt-1 text-xs opacity-80">
                Trace data will appear once the query finishes and <code className="rounded bg-[var(--surface-base)] px-1">trace_log</code> is flushed (typically within ~1s).
              </p>
            </>
          ) : (
            <>
              <p>No trace data available for this query.</p>
              <p className="mt-1 text-xs opacity-70">
                Trace data requires: (1) <code className="rounded bg-[var(--surface-base)] px-1">trace_log</code> enabled in ClickHouse config, and (2) sampling profilers enabled at query time.
              </p>
              <SettingHint settings={query.settings} settingKey="query_profiler_real_time_period_ns" label="Real-time profiler" />
              <SettingHint settings={query.settings} settingKey="query_profiler_cpu_time_period_ns" label="CPU profiler" />
            </>
          )}
        </div>
      )}
      {hasData && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-3 text-xs text-[var(--color-text-secondary)]">
          <p className="font-medium text-[var(--color-text-primary)]">How to read this graph</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 opacity-80">
            <li>Each bar represents a function. Width shows relative time or memory (by sample count).</li>
            <li>The stack grows upward: bottom is the entry point, top is the deepest nested call.</li>
            <li>Hover over any bar to see the full function name and sample count.</li>
            <li>Wider bars indicate functions consuming more resources. Narrow bars can be ignored.</li>
            <li>Use the buttons above to switch between Memory (Sampled/Alloc/Peak), Real Time, and CPU Time views.</li>
          </ul>
          <p className="mt-2 font-medium text-[var(--color-text-primary)]">Requirements</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 opacity-80">
            <li><code className="rounded bg-[var(--surface-base)] px-1">trace_log</code> must be enabled in ClickHouse <code className="rounded bg-[var(--surface-base)] px-1">config.xml</code></li>
            <li>Sampling profilers must be enabled at query time (Settings panel in SQL Editor)</li>
            <li><code className="rounded bg-[var(--surface-base)] px-1">allow_introspection_functions</code> must be enabled for symbol resolution</li>
          </ul>
        </div>
      )}
    </ChartSection>
  );
}
