import { Button } from "./button";

interface TimeframeOption<T> {
  label: string;
  value: T;
}

interface TimeframeSelectorProps<T extends string | number> {
  options: TimeframeOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}

/**
 * Segmented button group for picking one of a small set of preset values
 * (timeframes, intervals, age thresholds). The active option is highlighted.
 * Generic over the value type so it serves both numeric timeframes (hours /
 * seconds) and string enums (e.g. the fingerprint Hour/Day interval).
 */
export function TimeframeSelector<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: TimeframeSelectorProps<T>) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] p-0.5 ${className ?? ""}`}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Button
            key={String(opt.value)}
            variant="ghost"
            size="sm"
            onClick={() => onChange(opt.value)}
            className={active ? "bg-[var(--state-accent)] text-[var(--color-accent)]" : ""}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
