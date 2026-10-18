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

interface SortButtonProps<K extends string> {
  field: K;
  activeField?: K;
  dir: SortDir;
  onToggle: (field: K) => void;
  label: string;
  align?: "left" | "right";
  className?: string;
}

/**
 * The keyboard-activatable toggle inside a sort header, exposed separately for
 * "tables" that aren't real <table> markup (e.g. QueryList's virtualized div
 * rows), where {@link SortableHeader}'s <th> wrapper doesn't apply.
 * For server-side sorting, pass the current query params as activeField/dir
 * and issue the request update from onToggle — the component holds no state.
 */
export function SortButton<K extends string>({
  field,
  activeField,
  dir,
  onToggle,
  label,
  align = "left",
  className,
}: SortButtonProps<K>) {
  const active = activeField === field;
  return (
    <button
      type="button"
      onClick={() => onToggle(field)}
      aria-pressed={active}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]",
        align === "right" && "flex-row-reverse",
        className,
      )}
    >
      {label}
      {active && (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
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
  // `aria-sort` lives on the <th>; the actual toggle is a real <button> so it's
  // keyboard-activatable and announced as a control to assistive tech.
  const ariaSort = active ? (dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      aria-sort={ariaSort}
      scope="col"
      className={cn(
        "select-none font-medium text-[var(--color-text-secondary)]",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      <SortButton field={field} activeField={activeField} dir={dir} onToggle={onToggle} label={label} align={align} />
    </th>
  );
}
