import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SidebarSections } from "./storage";

interface AccordionHeaderProps {
  label: string;
  icon: ReactNode;
  sectionKey: keyof SidebarSections;
  sections: SidebarSections;
  onToggle: (key: keyof SidebarSections) => void;
  extra?: ReactNode;
}

export function AccordionHeader({ label, icon, sectionKey, sections, onToggle, extra }: AccordionHeaderProps) {
  return (
    <div
      data-section-header
      onClick={() => onToggle(sectionKey)}
      className="flex w-full cursor-pointer items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
    >
      {sections[sectionKey] ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      {icon}
      <span className="truncate">{label}</span>
      {extra}
    </div>
  );
}

interface SectionDividerProps {
  onDrag: (e: React.MouseEvent) => void;
}

export function SectionDivider({ onDrag }: SectionDividerProps) {
  return (
    <div
      className="h-1 shrink-0 cursor-row-resize hover:bg-[var(--color-accent)]"
      onMouseDown={onDrag}
    />
  );
}
