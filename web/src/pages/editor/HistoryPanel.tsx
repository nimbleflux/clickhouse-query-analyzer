import { Clock, Trash2 } from "lucide-react";
import { AccordionHeader } from "./AccordionSection";
import type { HistoryEntry, SidebarSections } from "./storage";

interface HistoryPanelProps {
  sections: SidebarSections;
  onToggleSection: (key: keyof SidebarSections) => void;
  history: HistoryEntry[];
  onLoad: (sql: string) => void;
  onClear: () => void;
  sectionStyle: React.CSSProperties;
}

export function HistoryPanel({
  sections, onToggleSection, history, onLoad, onClear, sectionStyle,
}: HistoryPanelProps) {
  return (
    <>
      <AccordionHeader
        label={`History${history.length > 0 ? ` (${history.length})` : ""}`}
        icon={<Clock className="h-3.5 w-3.5" />}
        sectionKey="history"
        sections={sections}
        onToggle={onToggleSection}
        extra={
          history.length > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="ml-auto rounded p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-error)] hover:bg-[var(--surface-hover)]"
              title="Clear history"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : undefined
        }
      />
      <div style={sectionStyle} className="border-b border-[var(--color-border)]">
        <div className="overflow-y-auto">
          {history.length > 0 ? history.map((entry, i) => (
            <button
              key={i}
              onClick={() => onLoad(entry.sql)}
              className="group/hist w-full border-b border-[var(--color-border)] last:border-0 px-3 py-1.5 text-left hover:bg-[var(--surface-hover)]"
            >
              <div className="truncate font-mono text-[11px] text-[var(--color-text-secondary)] group-hover/hist:text-[var(--color-text-primary)]">
                {entry.sql.replace(/\s+/g, " ").trim().slice(0, 80)}
              </div>
              <div className="text-[9px] text-[var(--color-text-secondary)] opacity-60">
                {new Date(entry.timestamp).toLocaleString()}
              </div>
            </button>
          )) : (
            <div className="px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
              No query history yet
            </div>
          )}
        </div>
      </div>
    </>
  );
}
