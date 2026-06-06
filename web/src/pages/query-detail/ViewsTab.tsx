import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/state";
import { formatBytes, formatDuration, formatNumber } from "@/utils";
import type { ViewLogEntry } from "@/api/types";

interface ViewsTabProps {
  views: ViewLogEntry[];
}

export function ViewsTab({ views }: ViewsTabProps) {
  if (views.length === 0) {
    return (
      <EmptyState
        icon={Eye}
        title="No views triggered"
        description="No materialized views were triggered by this query."
      />
    );
  }

  return (
    <div className="space-y-4">
      {views.map((v, i) => (
        <div key={i} className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-[var(--color-accent)]" />
              <span className="font-medium">{v.view_name}</span>
              <Badge variant="secondary">{v.view_type}</Badge>
            </div>
            <span className="text-sm text-[var(--color-text-secondary)]">{formatDuration(v.view_duration_ms)}</span>
          </div>
          <pre className="mb-2 max-h-24 overflow-auto font-mono text-xs text-[var(--color-text-secondary)]">{v.view_query}</pre>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--color-text-secondary)]">
            <span>Rows: {formatNumber(v.read_rows)} read / {formatNumber(v.written_rows)} written</span>
            <span>Memory: {formatBytes(v.peak_memory_usage)}</span>
            {v.exception && <span className="text-[var(--color-error)]">{v.exception}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
