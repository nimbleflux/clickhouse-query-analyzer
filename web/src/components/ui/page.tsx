import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: ReactNode;
  /** Optional element rendered on the right side of the header. */
  actions?: ReactNode;
  /** Optional breadcrumb rendered above the title. */
  breadcrumb?: ReactNode;
  /** Heading level — defaults to h1. Use h2 for sub-pages. */
  heading?: "h1" | "h2";
}

export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, actions, breadcrumb, heading = "h1", className, ...props }, ref) => {
    const Heading = heading;
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
          className
        )}
        {...props}
      >
        <div className="min-w-0 flex-1 space-y-1">
          {breadcrumb && (
            <div className="text-xs text-[var(--color-text-secondary)]">{breadcrumb}</div>
          )}
          <Heading
            className={cn(
              "font-bold tracking-tight text-[var(--color-text-primary)]",
              heading === "h1" ? "text-2xl" : "text-lg font-semibold"
            )}
          >
            {title}
          </Heading>
          {description && (
            <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    );
  }
);
PageHeader.displayName = "PageHeader";

interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Vertical spacing between children. Defaults to "md" (1rem). */
  spacing?: "none" | "sm" | "md" | "lg";
}

export const PageContainer = forwardRef<HTMLDivElement, PageContainerProps>(
  ({ spacing = "md", className, ...props }, ref) => {
    const spacingClass =
      spacing === "none" ? "" : spacing === "sm" ? "space-y-2" : spacing === "lg" ? "space-y-6" : "space-y-4";
    return (
      <div
        ref={ref}
        className={cn("mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8", spacingClass, className)}
        {...props}
      />
    );
  }
);
PageContainer.displayName = "PageContainer";
