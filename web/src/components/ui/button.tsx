import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
        secondary:
          "border border-[var(--color-border)] bg-[var(--surface-card)] text-[var(--color-text-primary)] hover:bg-[var(--surface-hover)]",
        ghost:
          "text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]",
        outline:
          "border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--surface-hover)]",
        destructive:
          "bg-[var(--color-error)] text-white hover:opacity-90",
        link:
          "text-[var(--color-accent)] underline-offset-4 hover:underline",
        toggle:
          "border border-[var(--color-border)] bg-[var(--surface-card)] text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)] data-[active=true]:border-[var(--color-accent)] data-[active=true]:bg-[var(--state-accent)] data-[active=true]:text-[var(--color-accent)]",
      },
      size: {
        sm: "h-7 rounded px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5",
        md: "h-8 rounded-md px-3 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5",
        lg: "h-10 rounded-md px-4 text-sm [&_svg]:h-4 [&_svg]:w-4",
        icon: "h-8 w-8 rounded-md [&_svg]:h-4 [&_svg]:w-4",
        "icon-sm": "h-6 w-6 rounded [&_svg]:h-3.5 [&_svg]:w-3.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, active, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        data-active={active}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
