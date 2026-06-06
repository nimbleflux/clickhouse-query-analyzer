import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--state-accent)] text-[var(--color-accent)] ring-[var(--color-accent)]/30",
        secondary:
          "bg-[var(--surface-elevated)] text-[var(--color-text-secondary)] ring-[var(--border-subtle)]",
        success:
          "bg-[var(--state-success)] text-[var(--color-success)] ring-[var(--color-success)]/30",
        warning:
          "bg-[var(--state-warning)] text-[var(--color-warning)] ring-[var(--color-warning)]/30",
        error:
          "bg-[var(--state-error)] text-[var(--color-error)] ring-[var(--color-error)]/30",
        outline:
          "bg-transparent text-[var(--color-text-secondary)] ring-[var(--color-border)]",
        mono:
          "bg-transparent font-mono text-[var(--color-text-secondary)] ring-[var(--border-subtle)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
);
Badge.displayName = "Badge";
