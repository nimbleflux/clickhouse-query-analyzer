import { Play } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { VisualExplain } from "@/components/VisualExplain";
import { PipelineDiagram } from "@/components/PipelineDiagram";
import { useTheme } from "@/api/theme";
import type { ExplainResult } from "@/api/types";
import { formatBytes, formatNumber } from "@/utils";
import { Card } from "@/components/ui/card";

interface ExplainTabProps {
  explain: ExplainResult | null;
}

function EstimateCard({ estimate }: { estimate: NonNullable<ExplainResult["estimate"]> }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Estimated Cost (EXPLAIN ESTIMATE)</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <div className="text-xs text-[var(--color-text-secondary)]">Rows</div>
          <div className="font-mono text-base font-semibold text-[var(--color-text-primary)]">{formatNumber(estimate.rows)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-secondary)]">Bytes</div>
          <div className="font-mono text-base font-semibold text-[var(--color-text-primary)]">{formatBytes(estimate.bytes)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-secondary)]">Blocks</div>
          <div className="font-mono text-base font-semibold text-[var(--color-text-primary)]">{formatNumber(estimate.blocks)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-secondary)]">Parts</div>
          <div className="font-mono text-base font-semibold text-[var(--color-text-primary)]">{formatNumber(estimate.parts)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-secondary)]">Marks</div>
          <div className="font-mono text-base font-semibold text-[var(--color-text-primary)]">{formatNumber(estimate.marks)}</div>
        </div>
      </div>
      <p className="mt-3 text-[10px] text-[var(--color-text-secondary)] opacity-70">
        Estimates from ClickHouse&apos;s planner. Actual values depend on merges, skips, and runtime conditions.
      </p>
    </Card>
  );
}

export function ExplainTab({ explain }: ExplainTabProps) {
  const theme = useTheme();
  const cmTheme = theme === "dark" ? oneDark : undefined;

  return (
    <div className="space-y-4">
      {explain ? (
        <>
          {explain.estimate && <EstimateCard estimate={explain.estimate} />}
          {explain.plan && (
            <VisualExplain plan={explain.plan} />
          )}
          {explain.pipeline_graph && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">Pipeline Diagram (EXPLAIN PIPELINE graph=1)</span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">Left-to-right operator graph</span>
              </div>
              <PipelineDiagram dot={explain.pipeline_graph} />
            </div>
          )}
          {explain.syntax && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
              <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">Normalized Syntax</div>
              <CodeMirror
                value={explain.syntax}
                extensions={[sql()]}
                theme={cmTheme}
                readOnly
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                className="text-xs [&_.cm-editor]:max-h-96 [&_.cm-editor]:overflow-auto [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs"
              />
            </div>
          )}
          <details className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)]">
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              Raw EXPLAIN text
            </summary>
            <div className="p-4 pt-0">
              {(["plan", "pipeline", "syntax"] as const).map((type) => {
                const content = explain[type];
                if (typeof content !== "string") return null;
                return (
                  <div key={type} className="mb-3">
                    <div className="mb-1 text-xs font-medium capitalize text-[var(--color-text-secondary)]">
                      {type === "plan" ? "Execution Plan" : type === "pipeline" ? "Query Pipeline" : "Normalized Syntax"}
                    </div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-text-primary)]">
                      {content}
                    </pre>
                  </div>
                );
              })}
            </div>
          </details>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 py-12">
          <Play className="h-8 w-8 text-[var(--color-text-secondary)]" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            Click &quot;explain&quot; tab to run EXPLAIN on this query
          </p>
        </div>
      )}
    </div>
  );
}
