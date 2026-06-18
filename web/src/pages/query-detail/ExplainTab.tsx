import { Play, AlertCircle } from "lucide-react";
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

  const hasContent = !!(explain && (explain.plan || explain.pipeline || explain.pipeline_graph || explain.syntax || explain.estimate));
  const errorEntries = explain?.errors ? Object.entries(explain.errors) : [];

  return (
    <div className="space-y-4">
      {hasContent ? (
        <>
          {explain && explain.estimate && <EstimateCard estimate={explain.estimate} />}
          {explain && explain.plan && (
            <VisualExplain plan={explain.plan} />
          )}
          {explain && explain.pipeline_graph && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">Pipeline Diagram (EXPLAIN PIPELINE graph=1)</span>
                <span className="text-[10px] text-[var(--color-text-secondary)]">Left-to-right operator graph</span>
              </div>
              <PipelineDiagram dot={explain.pipeline_graph} />
            </div>
          )}
          {explain && explain.syntax && (
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
              {explain && (["plan", "pipeline", "syntax"] as const).map((type) => {
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
          {errorEntries.length > 0 && <ExplainErrors errors={explain?.errors || {}} />}
        </>
      ) : explain ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-[var(--color-error)]/30 bg-[var(--state-error)] px-6 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-[var(--color-error)]" />
          <div className="text-sm font-medium text-[var(--color-error)]">EXPLAIN returned no data for this query</div>
          <p className="max-w-md text-xs text-[var(--color-text-secondary)]">
            This usually means the query text can&apos;t be re-explained in isolation (e.g. it references a session-scoped temp object, uses a disallowed clause, or the role lacks EXPLAIN privileges).
          </p>
          {errorEntries.length > 0 && (
            <div className="mt-2 w-full max-w-xl text-left">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">Per-variant errors</div>
              <div className="space-y-1">
                {errorEntries.map(([variant, msg]) => (
                  <div key={variant} className="rounded border border-[var(--color-error)]/30 bg-[var(--surface-card)] px-2 py-1">
                    <span className="font-mono text-[10px] font-medium text-[var(--color-error)]">{variant}:</span>{" "}
                    <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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

function ExplainErrors({ errors }: { errors: Record<string, string> }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <details className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--state-warning)]">
      <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-[var(--color-warning)]">
        {entries.length} EXPLAIN variant{entries.length > 1 ? "s" : ""} failed
      </summary>
      <div className="space-y-1 p-4 pt-0">
        {entries.map(([variant, msg]) => (
          <div key={variant}>
            <span className="font-mono text-[10px] font-medium text-[var(--color-warning)]">{variant}:</span>{" "}
            <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">{msg}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
