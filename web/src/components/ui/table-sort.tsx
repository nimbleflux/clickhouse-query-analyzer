import { useState, useCallback } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type SortDir = "asc" | "desc";

// Client-side table sort: holds the active field + direction. Clicking a new
// field sorts descending; re-clicking the active field flips asc/desc. Generic
// over the field union so each table's headers stay typed.
export function useTableSort<K extends string>(initialField?: K, initialDir: SortDir = "asc") {
  const [field, setField] = useState<K | undefined>(initialField);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const toggle = useCallback((f: K) => {
    setField(f);
    setDir((prev) => (f === field ? (prev === "asc" ? "desc" : "asc") : "desc"));
  }, [field]);
  return { field, dir, toggle };
}

interface SortableHeaderProps<K extends string> {
  field: K;
  activeField?: K;
  dir: SortDir;
  onToggle: (field: K) => void;
  label: string;
  align?: "left" | "right";
  // Padding/text sizing are table-specific, so the caller supplies them.
  className?: string;
}

export function SortableHeader<K extends string>({
  field,
  activeField,
  dir,
  onToggle,
  label,
  align = "left",
  className,
}: SortableHeaderProps<K>) {
  const active = activeField === field;
  return (
    <th
      className={cn(
        "cursor-pointer select-none font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      onClick={() => onToggle(field)}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {active && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}
