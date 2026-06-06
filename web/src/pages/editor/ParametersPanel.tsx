import { useRef } from "react";
import { Variable, X, Download, Upload, Trash2 } from "lucide-react";
import type { ParamSet } from "@/api/saved-queries";
import { AccordionHeader } from "./AccordionSection";
import type { SidebarSections, EditorSettings } from "./storage";

interface ParametersPanelProps {
  sections: SidebarSections;
  onToggleSection: (key: keyof SidebarSections) => void;
  settings: EditorSettings;
  onToggleParamsEnabled: (enabled: boolean) => void;
  detectedParams: string[];
  paramValues: Record<string, string>;
  onParamValuesChange: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  paramSets: ParamSet[];
  onSaveParamSet: (name: string) => void;
  onApplyParamSet: (ps: ParamSet) => void;
  onDeleteParamSet: (id: string) => void;
  onExportParamSets: () => void;
  onImportParamSets: (file: File) => void;
  saveDialogOpen: boolean;
  savingName: string;
  onSavingNameChange: (s: string) => void;
  onSaveDialogClose: () => void;
  onSaveDialogConfirm: () => void;
  sectionStyle: React.CSSProperties;
}

export function ParametersPanel({
  sections, onToggleSection, settings, onToggleParamsEnabled,
  detectedParams, paramValues, onParamValuesChange,
  paramSets, onSaveParamSet, onApplyParamSet, onDeleteParamSet,
  onExportParamSets, onImportParamSets,
  saveDialogOpen, savingName, onSavingNameChange, onSaveDialogClose, onSaveDialogConfirm,
  sectionStyle,
}: ParametersPanelProps) {
  const importParamsInputRef = useRef<HTMLInputElement>(null);

  const showInputs = settings.enable_params && sections.params && detectedParams.length > 0;
  const showEmpty = settings.enable_params && sections.params && detectedParams.length === 0;

  const handleImportParamsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportParamSets(file);
    e.target.value = "";
  };

  return (
    <>
      <AccordionHeader
        label={`Parameters${detectedParams.length > 0 ? ` (${detectedParams.length})` : ""}`}
        icon={<Variable className="h-3.5 w-3.5" />}
        sectionKey="params"
        sections={sections}
        onToggle={onToggleSection}
        extra={
          <label
            className="ml-auto flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-[var(--color-text-secondary)]"
            title="Enable {{param}} parameter detection and substitution"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={settings.enable_params}
              onChange={(e) => onToggleParamsEnabled(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            On
          </label>
        }
      />
      <div style={sectionStyle}>
        {showInputs && (
          <div className="space-y-2 px-3 py-2">
            {detectedParams.map((p) => (
              <div key={p}>
                <label className="mb-0.5 block text-[10px] font-medium text-[var(--color-text-secondary)]">
                  {`{{${p}}}`}
                </label>
                <input
                  type="text"
                  value={paramValues[p] || ""}
                  onChange={(e) => onParamValuesChange((prev) => ({ ...prev, [p]: e.target.value }))}
                  placeholder={p}
                  className={`w-full rounded border px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] ${!paramValues[p]?.trim() ? "border-[var(--color-error)]" : "border-[var(--color-border)]"} bg-[var(--surface-base)]`}
                />
              </div>
            ))}
            {detectedParams.length > 0 && (
              <div className="flex gap-1 pt-1">
                <button
                  onClick={() => onSaveParamSet("")}
                  className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--surface-hover)]"
                >
                  Save as set
                </button>
              </div>
            )}
            {paramSets.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Param sets</span>
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => importParamsInputRef.current?.click()}
                      className="rounded p-0.5 hover:bg-[var(--surface-hover)]"
                      title="Import param sets"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    <button
                      onClick={onExportParamSets}
                      className="rounded p-0.5 hover:bg-[var(--surface-hover)]"
                      title="Export param sets"
                    >
                      <Upload className="h-3 w-3" />
                    </button>
                    <input
                      ref={importParamsInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleImportParamsChange}
                      className="hidden"
                    />
                  </div>
                </div>
                {paramSets.map((ps) => (
                  <div key={ps.id} className="group/ps flex items-center gap-1">
                    <button
                      onClick={() => onApplyParamSet(ps)}
                      className="flex-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] text-[var(--color-text-primary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-accent)]"
                      title={`Apply: ${Object.entries(ps.params).map(([k, v]) => `${k}=${v}`).join(", ")}`}
                    >
                      {ps.name}
                    </button>
                    <button
                      onClick={() => onDeleteParamSet(ps.id)}
                      className="shrink-0 rounded p-0.5 text-[var(--color-text-secondary)] opacity-0 hover:bg-[var(--surface-elevated)] hover:text-[var(--color-error)] group-hover/ps:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-[var(--color-text-secondary)]">
              Use \&#123;&#123; to escape literal &#123;&#123; in SQL
            </p>
          </div>
        )}
        {showEmpty && (
          <div className="px-3 py-4 text-center text-xs text-[var(--color-text-secondary)]">
            <p>No parameters detected.</p>
            <p className="mt-1 text-[10px]">Use {"{{param_name}}"} syntax to add parameters.</p>
          </div>
        )}
        {saveDialogOpen && (
          <div className="bg-[var(--surface-hover)] px-3 py-2">
            <div className="mb-1.5 text-[10px] font-medium text-[var(--color-text-secondary)]">Save parameter set as</div>
            <div className="flex gap-1">
              <input
                type="text"
                value={savingName}
                onChange={(e) => onSavingNameChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSaveDialogConfirm(); if (e.key === "Escape") onSaveDialogClose(); }}
                placeholder="Set name..."
                autoFocus
                className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--surface-base)] px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={onSaveDialogConfirm}
                disabled={!savingName.trim()}
                className="rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={onSaveDialogClose}
                className="rounded px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
