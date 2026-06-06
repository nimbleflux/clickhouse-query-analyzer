import type { EditorSettings } from "./storage";

interface SettingsBarProps {
  settings: EditorSettings;
  onChange: (s: EditorSettings) => void;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
}

interface SettingToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  title: string;
  variant?: "default" | "danger";
}

function SettingToggle({ checked, onChange, label, title, variant = "default" }: SettingToggleProps) {
  const text = variant === "danger" ? "text-[var(--color-error)]" : "text-[var(--color-text-primary)]";
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 text-xs"
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={variant === "danger" ? "accent-[var(--color-error)]" : "accent-[var(--color-accent)]"}
      />
      <span className={text}>{label}</span>
    </label>
  );
}

export function SettingsBar({ settings, onChange, pageSize, onPageSizeChange }: SettingsBarProps) {
  const update = (key: keyof EditorSettings, value: boolean) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--color-border)] bg-[var(--surface-hover)] px-4 py-2">
      <SettingToggle
        checked={settings.log_queries}
        onChange={(v) => update("log_queries", v)}
        label="log_queries"
        title="Log this query to query_log"
      />
      <SettingToggle
        checked={settings.log_query_threads}
        onChange={(v) => update("log_query_threads", v)}
        label="log_query_threads"
        title="Log per-thread profiling data to query_thread_log"
      />
      <SettingToggle
        checked={settings.log_profile_events}
        onChange={(v) => update("log_profile_events", v)}
        label="log_profile_events"
        title="Collect ProfileEvents for the query (used in Storage, Overview tabs)"
      />
      <SettingToggle
        checked={settings.query_profiler_real_time_period_ns}
        onChange={(v) => update("query_profiler_real_time_period_ns", v)}
        label="real_time_profiler"
        title="Enable real-time (wall clock) profiler for flame graphs"
      />
      <SettingToggle
        checked={settings.query_profiler_cpu_time_period_ns}
        onChange={(v) => update("query_profiler_cpu_time_period_ns", v)}
        label="cpu_profiler"
        title="Enable CPU time profiler for flame graphs"
      />
      <SettingToggle
        checked={settings.allow_introspection_functions}
        onChange={(v) => update("allow_introspection_functions", v)}
        label="allow_introspection_functions"
        title="Allow introspection functions like addressToLine, demangle"
      />
      <SettingToggle
        checked={settings.readonly}
        onChange={(v) => update("readonly", v)}
        label="Read-only mode"
        title="Reject INSERT, ALTER, DROP, etc. Only allow SELECT and EXPLAIN queries"
        variant="danger"
      />
      <div className="ml-auto flex items-center gap-1 text-xs text-[var(--color-text-primary)]">
        Rows/page:
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded border border-[var(--color-border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-xs text-[var(--color-text-primary)]"
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
        </select>
      </div>
    </div>
  );
}

interface SaveQueryDialogProps {
  savingName: string;
  onNameChange: (s: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SaveQueryDialog({ savingName, onNameChange, onConfirm, onCancel }: SaveQueryDialogProps) {
  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--surface-hover)] px-3 py-2">
      <div className="mb-1.5 text-[10px] font-medium text-[var(--color-text-secondary)]">Save current query as</div>
      <div className="flex gap-1">
        <input
          type="text"
          value={savingName}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); if (e.key === "Escape") onCancel(); }}
          placeholder="Query name..."
          autoFocus
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--surface-base)] px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={onConfirm}
          disabled={!savingName.trim()}
          className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
