import { useState } from "react";
import { AlertTriangle, Copy, Check } from "lucide-react";
import type { Recommendation } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_TOOLTIPS } from "./types";

function severityVariant(severity: string): "error" | "warning" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  return "default";
}

function confidenceVariant(confidence: string): "success" | "warning" | "secondary" {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "warning";
  return "secondary";
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [copied, setCopied] = useState(false);

  const copyDDL = () => {
    if (!rec.ddl) return;
    navigator.clipboard.writeText(rec.ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityVariant(rec.severity)}>{rec.severity}</Badge>
            <Badge variant={confidenceVariant(rec.confidence)} title={CONFIDENCE_TOOLTIPS[rec.confidence] || ""}>
              {rec.confidence} confidence
            </Badge>
            <span className="text-sm font-medium">{rec.title}</span>
            {rec.requires_recreate && (
              <Badge variant="warning" title="This ALTER will fail on the existing table; a full recreate is required.">
                <AlertTriangle className="h-3 w-3" />
                recreate
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{rec.description}</p>
          {rec.current && rec.suggested && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <code className="rounded bg-[var(--surface-base)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">{rec.current}</code>
              <span className="text-[var(--color-text-secondary)]">&rarr;</span>
              <code className="rounded bg-[var(--surface-base)] px-1.5 py-0.5 text-[var(--color-accent)]">{rec.suggested}</code>
            </div>
          )}
          {rec.impact && (
            <p className="mt-1 text-xs italic text-[var(--color-text-secondary)]">{rec.impact}</p>
          )}
          {rec.ddl && (
            <div className="mt-2 flex items-center gap-2">
              <pre className="flex-1 overflow-x-auto rounded bg-[var(--surface-base)] p-2 text-xs text-[var(--color-text-secondary)]">{rec.ddl}</pre>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={copyDDL}
                title="Copy DDL"
                className="shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
