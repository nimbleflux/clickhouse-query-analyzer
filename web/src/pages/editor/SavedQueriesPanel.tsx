import { useRef } from "react";
import { Bookmark, Download, Upload, Play, RefreshCw, Trash2, Search, Variable } from "lucide-react";
import { detectParams } from "@/api/saved-queries";
import type { SavedQuery } from "@/api/saved-queries";
import { AccordionHeader } from "./AccordionSection";
import type { SidebarSections } from "./storage";

interface SavedQueriesPanelProps {
  sections: SidebarSections;
  onToggleSection: (key: keyof SidebarSections) => void;
  savedQueries: SavedQuery[];
  savedSearch: string;
  onSavedSearchChange: (s: string) => void;
  activeSQL: string;
  onLoadSaved: (q: SavedQuery) => void;
  onDeleteSaved: (id: string) => void;
  onOverwriteSaved: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  sectionStyle: React.CSSProperties;
}

export function SavedQueriesPanel({
  sections, onToggleSection, savedQueries, savedSearch, onSavedSearchChange,
  activeSQL, onLoadSaved, onDeleteSaved, onOverwriteSaved, onExport, onImport, sectionStyle,
}: SavedQueriesPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null);

  const matchedSaved = savedQueries.filter((q) => {
    if (!savedSearch.trim()) return true;
    const term = savedSearch.toLowerCase();
    return q.name.toLowerCase().includes(term) || q.sql.toLowerCase().includes(term);
  });
  const activeSavedId = savedQueries.find((q) => q.sql === activeSQL)?.id;

  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImport(file);
    e.target.value = "";
  };

  return (
    <>
      <AccordionHeader
        label="Saved Queries"
        icon={<Bookmark className="h-3.5 w-3.5" />}
        sectionKey="saved"
        sections={sections}
        onToggle={onToggleSection}
        extra={
          <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => importInputRef.current?.click()}
              className="rounded p-1 hover:bg-[var(--surface-hover)]"
              title="Import saved queries"
            >
              <Download className="h-3 w-3" />
            </button>
            <button
              onClick={onExport}
              disabled={savedQueries.length === 0}
              className="rounded p-1 hover:bg-[var(--surface-hover)] disabled:opacity-30"
              title="Export saved queries"
            >
              <Upload className="h-3 w-3" />
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              onChange={handleImportChange}
              className="hidden"
            />
            <span className="text-[10px] font-normal normal-case tracking-normal">
              {savedQueries.length}
            </span>
          </div>
        }
      />
      <div style={sectionStyle} className="border-b border-[var(--color-border)]">
        <div className="px-2 py-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              value={savedSearch}
              onChange={(e) => onSavedSearchChange(e.target.value)}
              placeholder="Search saved queries..."
              className="w-full rounded border border-[var(--color-border)] bg-[var(--surface-base)] py-1 pl-7 pr-2 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>
        <div className="overflow-y-auto">
          {matchedSaved.length > 0 ? matchedSaved.map((q) => {
            const params = detectParams(q.sql);
            const isActive = q.id === activeSavedId;
            return (
              <div
                key={q.id}
                className={`group/saved flex flex-col gap-0.5 border-b border-[var(--color-border)] px-2 py-1.5 last:border-0 ${isActive ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]"}`}
              >
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onLoadSaved(q)}
                    className="flex-1 truncate text-left text-xs font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] hover:underline"
                    title={`Load "${q.name}" into editor`}
                  >
                    {q.name}
                  </button>
                  <button
                    onClick={() => onLoadSaved(q)}
                    className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--color-accent)]"
                    title="Load into editor"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                  {isActive && (
                    <button
                      onClick={() => onOverwriteSaved(q.id)}
                      className="shrink-0 rounded p-0.5 text-[var(--color-accent)] hover:bg-[var(--surface-elevated)]"
                      title="Update saved query with current SQL"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={() => onDeleteSaved(q.id)}
                    className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] opacity-0 hover:bg-[var(--surface-elevated)] hover:text-[var(--color-error)] group-hover/saved:opacity-100"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <span className="truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
                    {q.sql.replace(/\s+/g, " ").trim().slice(0, 60)}
                    {q.sql.length > 60 ? "..." : ""}
                  </span>
                </div>
                {params.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {params.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center rounded bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-accent)]"
                      >
                        <Variable className="mr-0.5 h-2.5 w-2.5" />
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
              {savedSearch ? "No matching queries" : "No saved queries yet"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
