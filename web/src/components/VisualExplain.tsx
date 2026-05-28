import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

interface PlanNode {
  id: number;
  label: string;
  detail?: string;
  children: PlanNode[];
  depth: number;
}

function parsePlan(planStr: string): PlanNode | null {
  const lines = planStr.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  let nextId = 0;

  function getDepth(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  function parseLabel(line: string): { label: string; detail?: string } {
    const trimmed = line.trim();
    const parenIdx = trimmed.indexOf("(");
    if (parenIdx > 0 && trimmed.endsWith(")")) {
      return { label: trimmed.slice(0, parenIdx).trim(), detail: trimmed.slice(parenIdx + 1, -1).trim() };
    }
    return { label: trimmed };
  }

  function buildNode(idx: { v: number }, parentDepth: number): PlanNode | null {
    if (idx.v >= lines.length) return null;

    const line = lines[idx.v];
    const depth = getDepth(line);
    if (depth < parentDepth) return null;

    const { label, detail } = parseLabel(line);
    const node: PlanNode = { id: nextId++, label, detail, children: [], depth };

    idx.v++;
    while (idx.v < lines.length) {
      const childDepth = getDepth(lines[idx.v]);
      if (childDepth <= depth) break;
      const child = buildNode(idx, depth + 1);
      if (child) node.children.push(child);
    }

    return node;
  }

  return buildNode({ v: 0 }, -1);
}

function PlanTreeNode({ node, defaultExpanded = true }: { node: PlanNode; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children.length > 0;

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  return (
    <div className="font-mono text-xs">
      <div
        className={`flex items-start gap-1 rounded px-2 py-1 hover:bg-[var(--color-bg-primary)] ${hasChildren ? "cursor-pointer" : ""}`}
        onClick={hasChildren ? toggle : undefined}
      >
        <span className="mt-0.5 w-3.5 shrink-0 text-center">
          {hasChildren ? (
            expanded ? <ChevronDown className="h-3 w-3 text-[var(--color-text-secondary)]" /> : <ChevronRight className="h-3 w-3 text-[var(--color-text-secondary)]" />
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
        </span>
        <span className="font-semibold text-[var(--color-text-primary)]">{node.label}</span>
        {node.detail && (
          <span className="ml-1 text-[var(--color-text-secondary)]">({node.detail})</span>
        )}
        {hasChildren && (
          <span className="ml-1 text-[var(--color-text-secondary)] opacity-50">{node.children.length}</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="ml-4 border-l border-[var(--color-border)] pl-1">
          {node.children.map((child) => (
            <PlanTreeNode key={child.id} node={child} defaultExpanded={node.depth < 2} />
          ))}
        </div>
      )}
    </div>
  );
}

export function VisualExplain({ plan }: { plan: string }) {
  const tree = parsePlan(plan);

  if (!tree) {
    return (
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-text-primary)]">
        {plan}
      </pre>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Execution Plan (Visual)</span>
        <span className="text-[10px] text-[var(--color-text-secondary)]">Click nodes to expand/collapse</span>
      </div>
      <PlanTreeNode node={tree} defaultExpanded={true} />
    </div>
  );
}
