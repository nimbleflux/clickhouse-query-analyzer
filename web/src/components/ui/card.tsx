import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] text-[var(--color-text-primary)]",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 px-4 py-3 text-xs font-medium text-[var(--color-text-secondary)]", className)}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-sm font-semibold leading-none tracking-tight text-[var(--color-text-primary)]", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center px-4 py-3", className)}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

/** Semantic color of a StatCard's value, mapped to the design tokens. */
export type StatTone = "default" | "accent" | "success" | "warning" | "error";

const STAT_TONE_CLASS: Record<StatTone, string> = {
  default: "text-[var(--color-text-primary)]",
  accent: "text-[var(--color-accent)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  error: "text-[var(--color-error)]",
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Small icon rendered before the label (size is caller's choice, e.g. h-3 w-3). */
  icon?: ReactNode;
  tone?: StatTone;
  className?: string;
}

/**
 * Single "label over big number" card used in the page-header stat rows
 * (Dashboard, Replication, Merges, Mutations, …). Replaces the per-page
 * StatCard/MetricCard copies.
 */
export function StatCard({ label, value, icon, tone = "default", className }: StatCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 font-mono text-lg font-semibold", STAT_TONE_CLASS[tone])}>{value}</div>
    </Card>
  );
}

interface ChartCardProps {
  title: string;
  /** Optional one-line subtitle rendered under the title. */
  description?: ReactNode;
  /** Small icon rendered before the title. */
  icon?: ReactNode;
  /** Right-aligned slot for controls/links (e.g. drill-down buttons). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Titled chart container. Replaces the per-page ChartCard copies
 * (Replication, FingerprintDetail, Trends).
 */
export function ChartCard({ title, description, icon, actions, className, children }: ChartCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)]">
            {icon}
            {title}
          </div>
          {description && (
            <div className="text-[10px] text-[var(--color-text-secondary)] opacity-70">{description}</div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}
