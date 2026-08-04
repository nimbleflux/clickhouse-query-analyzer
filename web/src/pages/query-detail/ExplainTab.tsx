import { useState } from "react";
import { Play, AlertCircle, Ban, Activity, Gauge, ChevronDown } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { VisualExplain } from "@/components/VisualExplain";
import { PipelineDiagram } from "@/components/PipelineDiagram";
import { AnalyzePlanTree } from "@/components/AnalyzePlanTree";
import { useTheme } from "@/api/theme";
import { fetchExplainAnalyze } from "@/api/client";
import type { ExplainResult, ExplainAnalyze } from "@/api/types";
import { ApiError } from "@/api/errors";
import { formatBytes, formatNumber } from "@/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ExplainTabProps {
  queryId?: string;
  explain: ExplainResult | null;
}

function EstimateCard({ estimate }: { estimate: NonNullable<ExplainResult["estimate"]> }) {
  // ClickHouse 26.7 dropped the blocks and bytes estimate columns, so those
  // fields are 0 (omitted) on newer servers; only render cards for stats that
  // are actually available.
  const stats: { label: string; value: string }[] = [
    { label: "Rows", value: formatNumber(estimate.rows) },
    ...(estimate.bytes ? [{ label: "Bytes", value: formatBytes(estimate.bytes) }] : []),
    ...(estimate.blocks ? [{ label: "Blocks", value: formatNumber(estimate.blocks) }] : []),
    { label: "Parts", value: formatNumber(estimate.parts) },
    { label: "Marks", value: formatNumber(estimate.marks) },
  ];
  return (
    <Card className="p-4">
      <div className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">Estimated Cost (EXPLAIN ESTIMATE)</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-xs text-[var(--color-text-secondary)]">{s.label}</div>
            <div className="font-mono text-base font-semibold text-[var(--color-text-primary)]">{s.value}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-[var(--color-text-secondary)] opacity-70">
        Estimates from ClickHouse&apos;s planner. Actual values depend on merges, skips, and runtime conditions.
      </p>
    </Card>
  );
}

export function ExplainTab({ queryId, explain }: ExplainTabProps) {
  const theme = useTheme();
  const cmTheme = theme === "dark" ? oneDark : undefined;

  // EXPLAIN ANALYZE state — opt-in, never auto-fires. It re-executes the
  // query, so it must be triggered explicitly and is suppressed for
  // non-SELECT queries (where the planner-only EXPLAIN was skipped).
  const [analyze, setAnalyze] = useState<ExplainAnalyze | null>(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<ApiError | null>(null);
  const [processors, setProcessors] = useState(false);

  const runAnalyze = async () => {
    if (!queryId || analyzeLoading) return;
    setAnalyzeLoading(true);
    setAnalyzeError(null);
    try {
      const res = await fetchExplainAnalyze(queryId, processors);
      setAnalyze(res);
    } catch (e) {
      setAnalyzeError(ApiError.wrap(e));
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const hasContent = !!(explain && (explain.plan || explain.pipeline || explain.pipeline_graph || explain.syntax || explain.estimate));
  const errorEntries = explain?.errors ? Object.entries(explain.errors) : [];
  const skipped = !!explain?.errors?.skipped;

  return (
    <div className="space-y-4">
      {skipped ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] px-6 py-10 text-center">
          <Ban className="h-8 w-8 text-[var(--color-text-secondary)]" />
          <div className="text-sm font-medium text-[var(--color-text-primary)]">EXPLAIN not available for this query</div>
          <p className="max-w-md text-xs text-[var(--color-text-secondary)]">
            {explain?.errors?.skipped}
          </p>
        </div>
      ) : hasContent ? (
        <>
          <ExplainAnalyzeSection
            queryId={queryId}
            analyze={analyze}
            loading={analyzeLoading}
            error={analyzeError}
            processors={processors}
            onToggleProcessors={setProcessors}
            onRun={runAnalyze}
          />
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

// ExplainAnalyzeSection renders the opt-in "measured runtime plan". Unlike the
// planner-only EXPLAIN below it, this re-executes the query on the server to
// gather real per-step metrics (rows, time, parallelism, selectivity).
function ExplainAnalyzeSection({
  queryId,
  analyze,
  loading,
  error,
  processors,
  onToggleProcessors,
  onRun,
}: {
  queryId?: string;
  analyze: ExplainAnalyze | null;
  loading: boolean;
  error: ApiError | null;
  processors: boolean;
  onToggleProcessors: (v: boolean) => void;
  onRun: () => void;
}) {
  const canRun = !!queryId && !loading;
  // The backend gates on server version and returns errors.unsupported (HTTP
  // 200) on pre-26.7 builds, so this is a structured field, not an ApiError.
  const unsupported = analyze?.errors?.unsupported;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--color-accent)]" />
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            Measured runtime plan (EXPLAIN ANALYZE)
          </span>
          <span className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
            executes the query
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleProcessors(!processors)}
            disabled={!canRun}
            title="Add a per-processor min/median/max line under each stage to spot straggler threads"
            className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] transition-colors ${
              processors
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            } disabled:opacity-40`}
          >
            <Gauge className="h-3 w-3" />
            per-thread skew
          </button>
          <Button size="sm" variant="secondary" onClick={onRun} disabled={!canRun}>
            {loading ? "Running…" : analyze ? "Re-run" : "Run EXPLAIN ANALYZE"}
          </Button>
        </div>
      </div>

      {!analyze && !error && !loading && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Run the query to measure real per-step runtime, selectivity, and parallelism. Available on
          ClickHouse 26.7+.
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-text-secondary)]">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-text-secondary)] border-t-transparent" />
          Executing query and collecting runtime metrics…
        </div>
      )}

      {unsupported && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface-card)] px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-[var(--color-text-primary)]">
            <AlertCircle className="h-4 w-4 text-[var(--color-text-secondary)]" />
            EXPLAIN ANALYZE not available on this server
          </div>
          <p className="mt-1 text-[var(--color-text-secondary)]">{unsupported}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-error)]/30 bg-[var(--state-error)] px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-[var(--color-error)]">
            <AlertCircle className="h-4 w-4" />
            EXPLAIN ANALYZE failed
          </div>
          <p className="mt-1 text-[var(--color-text-secondary)]">{error.message}</p>
        </div>
      )}

      {analyze && !unsupported && (
        <div>
          <AnalyzePlanTree result={analyze} />
          {analyze.raw && (
            <details className="mt-2" open={false}>
              <summary className="flex cursor-pointer items-center gap-1 py-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                <ChevronDown className="h-3 w-3 transition-transform [[data-state=open]_&]:rotate-180" />
                Raw EXPLAIN ANALYZE text
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 font-mono text-xs text-[var(--color-text-primary)]">
                {analyze.raw}
              </pre>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
