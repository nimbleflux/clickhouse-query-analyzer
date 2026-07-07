import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { Loader2, Copy } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { format as formatSQL } from "sql-formatter";
import { useTheme } from "../../api/theme";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/state";

/**
 * Dialog that loads and renders a SQL statement (DDL, SHOW GRANTS output, …)
 * read-only with a Formatted/Raw toggle, copy button, and optional footer.
 *
 * `load` is called on open; abort on unmount/close. The title can be any
 * ReactNode (mono name, icon, …). Empty statements render a friendly empty
 * state instead of an empty editor.
 */
export function SqlStatementDialog({
  open,
  onOpenChange,
  title,
  load,
  loadingLabel = "Loading…",
  copyLabel = "Copied!",
  emptyLabel = "No statement returned.",
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  load: (signal: AbortSignal) => Promise<string>;
  loadingLabel?: string;
  copyLabel?: string;
  emptyLabel?: string;
  footer?: (stmt: string) => ReactNode;
}) {
  const theme = useTheme();
  const copy = useCopyToClipboard();
  const [stmt, setStmt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"formatted" | "raw">("formatted");
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    setStmt("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await load(controller.signal);
      if (!controller.signal.aborted) setStmt(res);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (open) run();
    return () => controllerRef.current?.abort();
  }, [open, run]);

  const { formatted, formatFailed } = useMemo(() => {
    if (!stmt) return { formatted: "", formatFailed: false };
    try {
      // mysql is the most tolerant dialect sql-formatter offers for ClickHouse
      // DDL/GRANT statements. If it still can't parse, fall back to raw so the
      // toggle never silently shows identical text.
      return { formatted: formatSQL(stmt, { language: "mysql", keywordCase: "upper" }), formatFailed: false };
    } catch {
      return { formatted: stmt, formatFailed: true };
    }
  }, [stmt]);
  const value = formatFailed || view === "raw" ? stmt : formatted;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-[120px]">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-[var(--color-text-secondary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {loadingLabel}
            </div>
          ) : error ? (
            <ErrorState error={error} />
          ) : stmt === "" ? (
            <div className="py-8 text-xs text-[var(--color-text-secondary)]">{emptyLabel}</div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-end gap-2">
                {formatFailed ? (
                  <span className="text-[10px] text-[var(--color-text-secondary)]" title="sql-formatter couldn't parse this statement">Raw only</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button variant={view === "formatted" ? "secondary" : "ghost"} size="sm" onClick={() => setView("formatted")}>Formatted</Button>
                    <Button variant={view === "raw" ? "secondary" : "ghost"} size="sm" onClick={() => setView("raw")}>Raw</Button>
                  </div>
                )}
                <Button variant="ghost" size="icon-sm" onClick={() => copy(value, copyLabel)} title="Copy">
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <CodeMirror
                value={value}
                extensions={[sql()]}
                theme={theme === "dark" ? oneDark : undefined}
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                className="text-xs [&_.cm-editor]:!bg-transparent [&_.cm-scroller]:!max-h-[55vh] [&_.cm-scroller]:!overflow-auto"
              />
            </>
          )}
        </DialogBody>
        {footer && <DialogFooter>{footer(stmt)}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
