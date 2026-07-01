import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FileCode, Send, Loader2, Copy, ListFilter } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { format as formatSQL } from "sql-formatter";
import { fetchTableDDL } from "../api/client";
import { useTheme } from "../api/theme";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { sendToEditor } from "@/lib/send-to-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/state";

/**
 * Renders `database.table` with a small icon button that opens a dialog showing
 * the table's SHOW CREATE statement (formatted, read-only). Drop it in anywhere
 * a table name appears so every table reference is one click from its DDL.
 */
export function TableName({ database, table, className }: { database: string; table: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <span className={className ?? ""}>
      <span className="text-[var(--color-text-secondary)]">{database}.</span>
      {table}
      <button
        type="button"
        onClick={() => navigate(`/queries?database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`)}
        title={`Show queries touching ${database}.${table}`}
        className="ml-1 inline-flex translate-y-[-1px] items-center rounded p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
      >
        <ListFilter className="h-3 w-3" />
      </button>
      <DdlButton database={database} table={table} open={open} onOpenChange={setOpen} inline />
    </span>
  );
}

/**
 * Just the DDL icon button + dialog (no table name). Use where the name is
 * already rendered elsewhere (e.g. the editor schema sidebar) and you only
 * want the affordance.
 */
export function DdlButton({
  database,
  table,
  open,
  onOpenChange,
  inline,
}: {
  database: string;
  table: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  inline?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`SHOW CREATE TABLE ${database}.${table}`}
        className={inline
          ? "ml-1 inline-flex translate-y-[-1px] items-center rounded p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]"
          : "shrink-0 rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-accent)]"}
      >
        <FileCode className="h-3 w-3" />
      </button>
      <DdlDialog open={isOpen} onOpenChange={setOpen} database={database} table={table} />
    </>
  );
}

function DdlDialog({
  open,
  onOpenChange,
  database,
  table,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  database: string;
  table: string;
}) {
  const theme = useTheme();
  const navigate = useNavigate();
  const copy = useCopyToClipboard();
  const [stmt, setStmt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"formatted" | "raw">("formatted");
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setStmt("");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const res = await fetchTableDDL(database, table, controller.signal);
      setStmt(res.statement);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load DDL");
    } finally {
      if (!controllerRef.current?.signal.aborted) setLoading(false);
    }
  }, [database, table]);

  useEffect(() => {
    if (open) load();
    return () => controllerRef.current?.abort();
  }, [open, load]);

  const { formatted, formatFailed } = useMemo(() => {
    if (!stmt) return { formatted: "", formatFailed: false };
    try {
      // mysql is the most tolerant dialect sql-formatter offers for ClickHouse
      // DDL (CREATE TABLE … ENGINE = …). If it still can't parse, we fall back
      // to raw so the toggle never silently shows identical text.
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
          <DialogTitle>
            <span className="font-mono text-sm">{database}.{table}</span>
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-[120px]">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-xs text-[var(--color-text-secondary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading DDL…
            </div>
          ) : error ? (
            <ErrorState error={error} />
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
                <Button variant="ghost" size="icon-sm" onClick={() => copy(value, "DDL copied!")} title="Copy DDL">
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
        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { onOpenChange(false); sendToEditor(navigate, stmt); }}
            disabled={!stmt}
          >
            <Send className="h-3 w-3" />
            Open in Editor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
