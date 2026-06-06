import { type ReactNode } from "react";
import { AlertCircle, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/api/errors";
import { Button } from "./button";

interface StatePanelProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Optional className override for the wrapper. */
  className?: string;
}

function StatePanel({ icon, title, description, action, className }: StatePanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] px-6 py-10 text-center",
        className
      )}
    >
      {icon && <div className="text-[var(--color-text-secondary)]">{icon}</div>}
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{title}</div>
      {description && (
        <div className="max-w-md text-xs text-[var(--color-text-secondary)]">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

interface EmptyStateProps extends Omit<StatePanelProps, "icon"> {
  icon?: LucideIcon;
  /** Optional override for icon size; defaults to h-10 w-10. */
  iconSize?: "sm" | "md" | "lg";
}

/**
 * Standard empty-state panel. Use when a list/view has no results to display.
 * Provide an `action` (typically a Button or link) when there's something the
 * user can do about it.
 */
export function EmptyState({ icon: Icon, iconSize = "md", title, description, action, className }: EmptyStateProps) {
  const sizeClass = iconSize === "sm" ? "h-6 w-6" : iconSize === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <StatePanel
      icon={Icon ? <Icon className={sizeClass} /> : null}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

interface ErrorStateProps {
  /** Error message, Error object, or ApiError. */
  error: Error | ApiError | string | null | undefined;
  /** Optional title override; defaults to a code-derived label for ApiError, otherwise "Something went wrong". */
  title?: string;
  /** Optional actionable hint to display alongside the error. */
  hint?: ReactNode;
  /** Optional retry callback. When provided, a "Try again" button is shown. Auto-shown for retryable ApiErrors if onRetry is omitted. */
  onRetry?: () => void;
  /** Optional className override. */
  className?: string;
}

/**
 * Standard error-state panel. Renders the error message in red, plus an
 * optional hint and retry button. Use this anywhere a fetch fails.
 *
 * When passed an ApiError, the panel automatically:
 *  - Derives a human title from the error code (e.g. "ClickHouse is unreachable").
 *  - Shows the server-supplied hint, if any.
 *  - Surfaces the retry button when the error is marked retryable.
 */
export function ErrorState({ error, title, hint, onRetry, className }: ErrorStateProps) {
  const isApi = error instanceof ApiError;
  const message = !error
    ? null
    : typeof error === "string"
      ? error
      : error.message || "Unknown error";
  const derivedTitle = title ?? (isApi ? titleFromCode(error.code) : "Something went wrong");
  const derivedHint = hint ?? (isApi && error.hint ? error.hint : null);
  const showRetry = onRetry !== undefined || (isApi && error.isRetryable() && onRetry !== null);
  const retry = onRetry;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-[var(--color-error)]/30 bg-[var(--state-error)] px-4 py-3 text-sm text-[var(--color-error)]",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="font-medium">{derivedTitle}</div>
        {message && <div className="font-mono text-xs break-words">{message}</div>}
        {derivedHint && <div className="text-xs opacity-90">{derivedHint}</div>}
      </div>
      {showRetry && retry && (
        <Button variant="ghost" size="sm" onClick={retry} className="shrink-0 text-[var(--color-error)]">
          <RefreshCw className="h-3 w-3" />
          Try again
        </Button>
      )}
    </div>
  );
}

function titleFromCode(code: string): string {
  switch (code) {
    case "CH_UNREACHABLE": return "Cannot reach ClickHouse";
    case "CH_EXCEPTION": return "ClickHouse rejected the request";
    case "NOT_FOUND": return "Not found";
    case "FORBIDDEN": return "Action not allowed";
    case "MISSING_PARAM":
    case "INVALID_PARAM":
    case "INVALID_BODY": return "Invalid request";
    case "NETWORK_ERROR": return "Network error";
    case "INTERNAL":
    default: return "Something went wrong";
  }
}

interface LoadingStateProps {
  /** Optional message. Defaults to "Loading…". */
  message?: string;
  /** When true, renders a full card-style skeleton panel; otherwise an inline row. */
  variant?: "inline" | "card";
  /** Optional className override. */
  className?: string;
}

/**
 * Standard loading-state panel. For richer table/card skeletons, prefer the
 * existing TableSkeleton / CardSkeleton components.
 */
export function LoadingState({ message = "Loading…", variant = "card", className }: LoadingStateProps) {
  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2 px-4 py-3 text-xs text-[var(--color-text-secondary)]", className)}>
        <RefreshCw className="h-3 w-3 animate-spin" />
        {message}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] px-6 py-10",
        className
      )}
    >
      <RefreshCw className="h-6 w-6 animate-spin text-[var(--color-text-secondary)]" />
      <div className="text-xs text-[var(--color-text-secondary)]">{message}</div>
    </div>
  );
}
