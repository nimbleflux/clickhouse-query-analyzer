import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchThreadSummaries, fetchThreadProfile } from "@/api/client";
import type { ThreadEntry, ThreadSummary, ThreadProfile } from "@/api/types";
import { formatBytes, formatDuration, formatNumber } from "@/utils";
import { ChartSection, SettingHint, parsePipeline, KEY_PROFILE_EVENTS } from "./shared";
import { ThreadGantt } from "./ThreadGantt";

interface ThreadsTabProps {
  queryId: string;
  threads: ThreadEntry[];
  pipelineStr?: string;
  querySettings?: Record<string, string>;
}

export function ThreadsTab({ queryId, threads, pipelineStr, querySettings }: ThreadsTabProps) {
  const [threadSummaries, setThreadSummaries] = useState<ThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<number | null>(null);
  const [threadProfile, setThreadProfile] = useState<ThreadProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [showAllEvents, setShowAllEvents] = useState(false);

  useEffect(() => {
    if (threads.length === 0) return;
    fetchThreadSummaries(queryId).then(setThreadSummaries).catch(() => {});
  }, [threads.length, queryId]);

  useEffect(() => {
    if (selectedThread === null) { setThreadProfile(null); setProfileError(""); return; }
    setProfileLoading(true);
    setProfileError("");
    fetchThreadProfile(queryId, selectedThread)
      .then((p) => { setThreadProfile(p); setProfileError(""); })
      .catch((e) => { setThreadProfile(null); setProfileError(e instanceof Error ? e.message : "Failed to load thread profile"); })
      .finally(() => setProfileLoading(false));
  }, [selectedThread, queryId]);

  const pipelineSteps = pipelineStr ? parsePipeline(pipelineStr) : [];

  const roleColor = (role: string) => {
    switch (role) {
      case "Coordinator": return "bg-[var(--color-accent)]/10 text-[var(--color-accent)]";
      case "Scan + Filter": return "bg-[var(--color-success)]/10 text-[var(--color-success)]";
      case "Table Scanner": return "bg-[var(--color-success)]/10 text-[var(--color-success)]";
      case "Reader": return "bg-[var(--color-success)]/10 text-[var(--color-success)]";
      case "Aggregator": return "bg-[var(--color-accent)]/10 text-[var(--color-accent)]";
      case "Filter": return "bg-[var(--color-warning)]/10 text-[var(--color-warning)]";
      case "I/O Pool": return "bg-[var(--color-warning)]/10 text-[var(--color-warning)]";
      case "Pipeline Manager": return "bg-[var(--color-accent)]/10 text-[var(--color-accent)]";
      default: return "bg-[var(--color-text-secondary)]/10 text-[var(--color-text-secondary)]";
    }
  };

  if (threadSummaries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
        No thread data available for this query.
        <SettingHint settings={querySettings} settingKey="log_query_threads" label="log_query_threads" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ThreadGantt threads={threads} />

      {pipelineSteps.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
          <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Execution Pipeline</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {pipelineSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-elevated)] px-2 py-1 text-xs font-mono">
                  {step.name}
                  {step.count > 1 && <span className="text-[var(--color-text-secondary)]">x{step.count}</span>}
                </span>
                {i < pipelineSteps.length - 1 && <span className="text-[var(--color-text-secondary)]">&rarr;</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <ChartSection title="Thread Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">Thread</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--color-text-secondary)]">Role</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Peak Mem</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Read Rows</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Read Bytes</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">CPU Time</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">I/O Wait</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Duration</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-secondary)]">Filter</th>
              </tr>
            </thead>
            <tbody>
              {threadSummaries.map((t) => {
                const isSelected = selectedThread === t.thread_id;
                const cpuUs = (t.user_time_us || 0) + (t.system_time_us || 0);
                const selectivity = t.filter_total_rows > 0
                  ? `${((t.filter_passed_rows / t.filter_total_rows) * 100).toFixed(0)}%`
                  : "-";
                return (
                  <>
                    <tr
                      key={t.thread_id}
                      onClick={() => setSelectedThread(isSelected ? null : t.thread_id)}
                      className="cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      <td className="px-3 py-2 text-xs font-mono">
                        <span className="inline-flex items-center gap-1">
                          {isSelected ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          #{t.thread_id} {t.thread_name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${roleColor(t.role)}`}>{t.role}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatBytes(t.peak_memory_usage)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.read_rows > 0 ? formatNumber(t.read_rows) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.read_bytes > 0 ? formatBytes(t.read_bytes) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{cpuUs > 0 ? formatDuration(cpuUs / 1000) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.disk_read_us > 0 ? formatDuration(t.disk_read_us / 1000) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatDuration(t.query_duration_ms)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-[var(--color-text-secondary)]">{selectivity}</td>
                    </tr>
                    {isSelected && (
                      <tr key={`${t.thread_id}-detail`}>
                        <td colSpan={9} className="border-b border-[var(--color-border)] p-0">
                          <ThreadDetailPanel profile={threadProfile} loading={profileLoading} error={profileError} showAllEvents={showAllEvents} onToggleEvents={() => setShowAllEvents(!showAllEvents)} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartSection>
    </div>
  );
}

function ThreadDetailPanel({ profile, loading, error, showAllEvents, onToggleEvents }: {
  profile: ThreadProfile | null;
  loading: boolean;
  error: string;
  showAllEvents: boolean;
  onToggleEvents: () => void;
}) {
  if (loading) {
    return <div className="bg-[var(--surface-elevated)] px-6 py-4 text-xs text-[var(--color-text-secondary)]">Loading thread profile...</div>;
  }
  if (!profile) {
    return <div className="bg-[var(--surface-elevated)] px-6 py-4 text-xs text-[var(--color-error)]">{error || "Failed to load thread profile."}</div>;
  }

  const selectivity = profile.profile_events["SelectedRows"] > 0 && profile.profile_events["FilterTransformPassedRows"] > 0
    ? ((profile.profile_events["FilterTransformPassedRows"] / profile.profile_events["SelectedRows"]) * 100).toFixed(1)
    : null;

  return (
    <div className="space-y-4 bg-[var(--surface-elevated)] px-6 py-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Peak Memory</div>
          <div className="text-sm font-bold">{formatBytes(profile.peak_memory_usage)}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Read</div>
          <div className="text-sm font-bold">{formatNumber(profile.read_rows)} rows</div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">{formatBytes(profile.read_bytes)}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">CPU User / Sys</div>
          <div className="text-sm font-bold">
            {formatDuration((profile.profile_events["UserTimeMicroseconds"] || 0) / 1000)} / {formatDuration((profile.profile_events["SystemTimeMicroseconds"] || 0) / 1000)}
          </div>
        </div>
        <div className="rounded border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Wall Clock</div>
          <div className="text-sm font-bold">{formatDuration(profile.duration_ms)}</div>
        </div>
      </div>

      {selectivity !== null && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
          <div className="text-[10px] text-[var(--color-text-secondary)]">Filter Selectivity</div>
          <div className="flex items-center gap-3">
            <div className="text-sm font-bold">{selectivity}% passed</div>
            <div className="flex-1">
              <div className="h-2 rounded-full bg-[var(--surface-base)]">
                <div className="h-2 rounded-full bg-[var(--color-success)]" style={{ width: `${selectivity}%` }} />
              </div>
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">
              {formatNumber(profile.profile_events["FilterTransformPassedRows"])} / {formatNumber(profile.profile_events["SelectedRows"])} rows
            </div>
          </div>
        </div>
      )}

      {profile.top_functions.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-medium text-[var(--color-text-secondary)]">
            Top Functions ({formatNumber(profile.total_samples)} trace samples)
          </div>
          <div className="max-h-48 overflow-auto rounded border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--surface-card)]">
                  <th className="px-3 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)]">%</th>
                  <th className="px-3 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)]">Samples</th>
                  <th className="px-3 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-secondary)]">Function</th>
                </tr>
              </thead>
              <tbody>
                {profile.top_functions.map((f, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-3 py-1 font-mono">
                      <div className="flex items-center gap-2">
                        <div className="w-12 rounded bg-[var(--surface-card)]">
                          <div className="h-1.5 rounded bg-[var(--color-accent)]" style={{ width: `${Math.min(f.percent, 100)}%` }} />
                        </div>
                        <span className="text-[var(--color-text-secondary)]">{f.percent.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-1 font-mono text-[var(--color-text-secondary)]">{formatNumber(f.samples)}</td>
                    <td className="px-3 py-1 font-mono">{f.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <button onClick={onToggleEvents} className="flex items-center gap-1 text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          {showAllEvents ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          All Profile Events ({Object.keys(profile.profile_events).length})
        </button>
        {showAllEvents && (
          <div className="mt-2 grid grid-cols-3 gap-x-6 gap-y-0.5">
            {Object.entries(profile.profile_events)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex justify-between text-[10px]">
                  <span className="text-[var(--color-text-secondary)]">{k}</span>
                  <span className="font-mono">{formatNumber(v)}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium text-[var(--color-text-secondary)]">Key Metrics</div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          {KEY_PROFILE_EVENTS.map(([key, label, fmt]) => {
            const val = profile.profile_events[key];
            if (!val) return null;
            return (
              <div key={key} className="flex justify-between text-[10px]">
                <span className="text-[var(--color-text-secondary)]">{label}</span>
                <span className="font-mono">{fmt(val)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
