import { forwardRef, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] shadow-[var(--shadow-md)] data-[state=delayed-open]:animate-[overlayShow_0.15s_ease-out]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

interface SimpleTooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** When true, suppresses the tooltip entirely (useful for conditional display). */
  disabled?: boolean;
}

/**
 * Convenience wrapper: wraps a single child with a hover/focus tooltip.
 * The child must be a single, focusable element for keyboard accessibility.
 * For non-focusable children, wrap them in a <span tabIndex={0}>.
 */
export function SimpleTooltip({ content, children, side = "top", disabled }: SimpleTooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
