import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FileCode, Send, ListFilter } from "lucide-react";
import { fetchTableDDL } from "../api/client";
import { sendToEditor } from "@/lib/send-to-editor";
import { Button } from "@/components/ui/button";
import { SqlStatementDialog } from "@/components/ui/SqlStatementDialog";

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
  const navigate = useNavigate();
  const load = useCallback(
    (signal: AbortSignal) => fetchTableDDL(database, table, signal).then((r) => r.statement),
    [database, table],
  );
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
      <SqlStatementDialog
        open={isOpen}
        onOpenChange={setOpen}
        title={<span className="font-mono text-sm">{database}.{table}</span>}
        load={load}
        loadingLabel="Loading DDL…"
        copyLabel="DDL copied!"
        footer={(stmt) => (
          <Button variant="secondary" size="sm" onClick={() => { setOpen(false); sendToEditor(navigate, stmt); }} disabled={!stmt}>
            <Send className="h-3 w-3" />
            Open in Editor
          </Button>
        )}
      />
    </>
  );
}
