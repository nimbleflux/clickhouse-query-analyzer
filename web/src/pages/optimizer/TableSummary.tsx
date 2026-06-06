import { formatBytes, formatNumber } from "@/utils";
import type { TableAnalysis } from "@/api/types";

interface TableSummaryProps {
  analysis: TableAnalysis;
  compact?: boolean;
}

interface SummaryItem {
  label: string;
  value: string;
}

function buildItems(analysis: TableAnalysis): SummaryItem[] {
  return [
    { label: "Engine", value: analysis.engine },
    { label: "Rows", value: formatNumber(analysis.total_rows) },
    { label: "Size", value: formatBytes(analysis.total_bytes) },
    { label: "Parts", value: String(analysis.parts?.length || 0) },
    { label: "ORDER BY", value: analysis.order_by_key || "(none)" },
    { label: "PARTITION BY", value: analysis.partition_key || "(none)" },
  ];
}

export function TableSummary({ analysis, compact }: TableSummaryProps) {
  const items = buildItems(analysis);

  if (compact) {
    return (
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {items.map((i) => (
          <span key={i.label}><span className="font-medium text-[var(--color-text-primary)]">{i.label}:</span> {i.value}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
          <div className="text-xs text-[var(--color-text-secondary)]">{i.label}</div>
          <div className="mt-1 truncate text-sm font-medium" title={i.value}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}
