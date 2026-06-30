import { Loader2, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, Table2, ExternalLink, Database } from "lucide-react";
import { formatNumber } from "@/utils";
import type { SchemaData } from "@/api/schema-cache";
import { AccordionHeader } from "./AccordionSection";
import type { SidebarSections } from "./storage";
import { DdlButton } from "@/components/TableName";

interface SchemaSidebarProps {
  sections: SidebarSections;
  onToggleSection: (key: keyof SidebarSections) => void;
  databases: string[];
  schemaData: SchemaData;
  schemaLoading: boolean;
  schemaStale: boolean;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  onInsertAtCursor: (text: string) => void;
  onSetSQLText: (sql: string) => void;
  onRefreshSchema: () => void;
  sectionStyle: React.CSSProperties;
}

export function SchemaSidebar({
  sections, onToggleSection, databases, schemaData, schemaLoading, schemaStale,
  expanded, onToggleExpand, onInsertAtCursor, onSetSQLText, onRefreshSchema, sectionStyle,
}: SchemaSidebarProps) {
  return (
    <>
      <AccordionHeader
        label="Schema"
        icon={<Database className="h-3.5 w-3.5" />}
        sectionKey="schema"
        sections={sections}
        onToggle={onToggleSection}
        extra={
          <button
            onClick={(e) => { e.stopPropagation(); onRefreshSchema(); }}
            disabled={schemaLoading}
            className="ml-auto rounded p-1 hover:bg-[var(--surface-hover)] disabled:opacity-50"
            title="Reload schema"
          >
            <RefreshCw className={`h-3 w-3 ${schemaLoading ? "animate-spin" : ""}`} />
            {schemaStale && !schemaLoading && <AlertTriangle className="ml-0.5 inline h-3 w-3 text-[var(--color-warning)]" />}
          </button>
        }
      />
      <div style={sectionStyle} className="border-b border-[var(--color-border)]">
        <div className="p-1">
          {databases.length > 0 ? databases.map((dbName) => (
            <div key={dbName}>
              <button
                onClick={() => onToggleExpand(`db:${dbName}`)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--surface-hover)]"
              >
                {expanded.has(`db:${dbName}`) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                <span className="truncate">{dbName}</span>
                {schemaData[dbName]?.loading && <Loader2 className="ml-1 h-3 w-3 animate-spin shrink-0" />}
                {!schemaData[dbName]?.loading && schemaData[dbName]?.tables && (
                  <span className="ml-auto shrink-0 text-[10px] text-[var(--color-text-secondary)]">{schemaData[dbName].tables!.length}</span>
                )}
              </button>
              {expanded.has(`db:${dbName}`) && (schemaData[dbName]?.tables || []).map((t) => (
                <div key={t.name} className="group relative">
                  <div className="flex items-center">
                    <button
                      onClick={() => onToggleExpand(`tbl:${dbName}.${t.name}`)}
                      className="flex flex-1 min-w-0 items-center gap-1 rounded px-2 py-1 pl-5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--surface-hover)]"
                    >
                      {expanded.has(`tbl:${dbName}.${t.name}`) ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <Table2 className="h-3 w-3 shrink-0 text-[var(--color-text-secondary)]" />
                      <span className="truncate">{t.name}</span>
                      {t.row_count > 0 && <span className="ml-1 shrink-0 text-[10px] text-[var(--color-text-secondary)]">({formatNumber(t.row_count)})</span>}
                    </button>
                    <button
                      onClick={() => onSetSQLText(`SELECT * FROM "${dbName}"."${t.name}"`)}
                      className="mr-1 shrink-0 rounded p-1 text-[var(--color-accent)] hover:bg-[var(--surface-hover)]"
                      title="SELECT * FROM"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                    <DdlButton database={dbName} table={t.name} />
                  </div>
                  {expanded.has(`tbl:${dbName}.${t.name}`) && (
                    <div className="pl-10">
                      {t.columns ? t.columns.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => onInsertAtCursor(c.name)}
                          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-[11px] font-mono text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0 text-[9px] opacity-60">{c.type}</span>
                        </button>
                      )) : (
                        <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading columns...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {expanded.has(`db:${dbName}`) && !schemaData[dbName]?.tables && !schemaData[dbName]?.loading && (
                <div className="px-5 py-1 text-[10px] text-[var(--color-text-secondary)]">Failed to load tables</div>
              )}
            </div>
          )) : (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-[var(--color-text-secondary)]">
              {schemaLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {schemaLoading ? "Loading databases..." : "No databases found"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
