import { EmptyState } from "@/components/ui/state";
import { Settings as SettingsIcon } from "lucide-react";

interface SettingsTabProps {
  settings: Record<string, string> | undefined;
}

export function SettingsTab({ settings }: SettingsTabProps) {
  const entries = Object.entries(settings || {}).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={SettingsIcon}
        title="No settings recorded"
        description="This query did not have any non-default settings."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--surface-elevated)]">
            <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Setting</th>
            <th className="px-4 py-2 text-left font-medium text-[var(--color-text-secondary)]">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-2 font-mono text-xs">{k}</td>
              <td className="px-4 py-2 font-mono text-xs text-[var(--color-accent)]">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
