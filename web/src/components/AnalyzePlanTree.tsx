import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { ExplainAnalyze } from "@/api/types";
import { formatBytes, formatNumber, formatDuration } from "@/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StageMetrics {
  label?: string; // e.g. "partial aggregation" — present when a step has >1 stage
  timeMs?: number;
  timePct?: number; // share of total query execution time
  parallelUsed?: number;
  parallelMax?: number;
  // Per-processor distribution (only when EXPLAIN ANALYZE processors = 1)
  procMinMs?: number;
  procMedianMs?: number;
  procMaxMs?: number;
  procSumMs?: number;
}

interface NodeMetrics {
  rowsIn?: number;
  rowsOut?: number;
  bytesIn?: number;
  bytesOut?: number;
  selectivity?: number; // rowsOut/rowsIn as a fraction (0..1); omitted if in==0
  stages: StageMetrics[];
  // MergeTree read coverage — only present on ReadFromMergeTree steps. The
  // Indexes: block lists each index ClickHouse applied with how many of the
  // available parts/granules survived it; the most-restrictive determines the
  // actual read. Parsed separately from `attributes` because the flat map
  // can't represent the repeated Parts:/Granules: keys without collision.
  partsTotal?: number; // top-level "Parts: 2 | Granules: 12"
  granulesTotal?: number;
  indexes: IndexUsage[];
}

// IndexUsage describes one entry in a ReadFromMergeTree "Indexes:" block.
interface IndexUsage {
  name: string; // "Min-Max" | "Partition" | "PrimaryKey" | "Ranges" | ...
  condition?: string; // "true" | "(column) IN (...)" | absent
  partsRead?: number;
  partsTotal?: number;
  granulesRead?: number;
  granulesTotal?: number;
}

interface AnalyzeNode {
  id: number;
  label: string;
  detail?: string; // parenthesised suffix, e.g. "(Project names + Projection)"
  attributes: Record<string, string>; // Keys:, Output:, Aggregates:, ...
  metrics: NodeMetrics;
  children: AnalyzeNode[];
  depth: number;
}

// ---------------------------------------------------------------------------
// Parser
//
// EXPLAIN ANALYZE prints a tree with box-drawing connectors (├── └── │) and
// indented metric lines under each step:
//
//   Expression ((Project names + Projection))
//   │  I/O: rows 10 → 10 · 90 B → 90 B
//   │    time 21.82 us (0.5%) · parallelism 0.98/1
//   └──Aggregating
//      │  Keys: number MOD 10
//      │  I/O: rows 1.00 million → 10 (0.00%) · 1.00 MB → 90 B
//      │    Stage (partial aggregation): time 868.45 us (20.4%) · parallelism 3.80/15
//      │    Stage (final aggregation): time 445.27 us (10.4%) · parallelism 1.11/16
//
// Steps are joined by ├── / └── lines; their metric lines are prefixed with
// │ or whitespace at a deeper indent. We classify each non-blank line as a
// step line, an "I/O:" line, a "Stage"/time line, a processor line, or an
// attribute (Keys:/Output:/...).
// ---------------------------------------------------------------------------

function parseCount(token: string, unit: string): number {
  const n = parseFloat(token);
  if (!Number.isFinite(n)) return 0;
  switch (unit.toLowerCase()) {
    case "thousand":
      return n * 1e3;
    case "million":
      return n * 1e6;
    case "billion":
      return n * 1e9;
    default:
      return n;
  }
}

function parseBytes(token: string, unit: string): number {
  const n = parseFloat(token);
  if (!Number.isFinite(n)) return 0;
  switch (unit.toLowerCase()) {
    case "b":
      return n;
    case "kib":
    case "kb":
      return n * 1024;
    case "mib":
    case "mb":
      return n * 1024 * 1024;
    case "gib":
    case "gb":
      return n * 1024 * 1024 * 1024;
    case "tib":
    case "tb":
      return n * 1024 * 1024 * 1024 * 1024;
    default:
      return n;
  }
}

// "1.00 million", "10", "8.00 MB", "90 B", "0.00%"
function parseNumberWithUnit(rest: string): number {
  const m = rest.match(/([\d.]+)\s*(\w+)?/);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  // Heuristic: byte-like units end in 'b'; row magnitudes are named words.
  if (unit === "b" || unit === "kib" || unit === "kb" || unit === "mib" || unit === "mb" ||
      unit === "gib" || unit === "gb" || unit === "tib" || unit === "tb") {
    return parseBytes(m[1], unit);
  }
  if (unit === "thousand" || unit === "million" || unit === "billion") {
    return parseCount(m[1], unit);
  }
  return val;
}

// Parses an "I/O:" line:
//   "I/O: rows 1.00 million → 10 (0.00%) · 1.00 MB → 90 B"
function parseIoLine(line: string, metrics: NodeMetrics) {
  // Rows: everything between "rows" and "·" or "(" or end.
  const rowsMatch = line.match(/rows\s+([\d.]+\s*\w*)\s*→\s*([\d.]+\s*\w*)\s*(?:\(([\d.]+)%\))?/);
  if (rowsMatch) {
    metrics.rowsIn = parseNumberWithUnit(rowsMatch[1]);
    metrics.rowsOut = parseNumberWithUnit(rowsMatch[2]);
    if (rowsMatch[3] != null) {
      metrics.selectivity = parseFloat(rowsMatch[3]) / 100;
    } else if (metrics.rowsIn && metrics.rowsIn > 0) {
      metrics.selectivity = metrics.rowsOut / metrics.rowsIn;
    }
  }
  // Bytes: optional, "1.00 MB → 90 B"
  const bytesMatch = line.match(/·\s*([\d.]+\s*\w+[bB]?)\s*→\s*([\d.]+\s*\w+[bB]?)/);
  if (bytesMatch) {
    metrics.bytesIn = parseNumberWithUnit(bytesMatch[1]);
    metrics.bytesOut = parseNumberWithUnit(bytesMatch[2]);
  }
}

// Parses a stage/time line. Two forms:
//   "time 21.82 us (0.5%) · parallelism 0.98/1"
//   "Stage (partial aggregation): time 868.45 us (20.4%) · parallelism 3.80/15"
// And an optional following processor line:
//   "processors: 1.23/4.56/7.89/13.57 ms"  (min/median/max/sum)
function parseStageLine(line: string, processorsLine?: string): StageMetrics | null {
  const stage: StageMetrics = {};
  const labelMatch = line.match(/Stage\s*\(([^)]+)\)\s*:/);
  if (labelMatch) stage.label = labelMatch[1].trim();

  const timeMatch = line.match(/time\s+([\d.]+)\s*(ns|us|µs|ms|s)\s*(?:\(([\d.]+)%\))?/);
  if (timeMatch) {
    stage.timeMs = toMillis(parseFloat(timeMatch[1]), timeMatch[2]);
    if (timeMatch[3] != null) stage.timePct = parseFloat(timeMatch[3]);
  }
  const parMatch = line.match(/parallelism\s+([\d.]+)\/([\d.]+)/);
  if (parMatch) {
    stage.parallelUsed = parseFloat(parMatch[1]);
    stage.parallelMax = parseFloat(parMatch[2]);
  }

  // Processor distribution (processors=1): "min/median/max/sum" on the next line.
  if (processorsLine) {
    const pm = processorsLine.match(/([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*(ns|us|µs|ms|s)/);
    if (pm) {
      const unit = pm[5];
      stage.procMinMs = toMillis(parseFloat(pm[1]), unit);
      stage.procMedianMs = toMillis(parseFloat(pm[2]), unit);
      stage.procMaxMs = toMillis(parseFloat(pm[3]), unit);
      stage.procSumMs = toMillis(parseFloat(pm[4]), unit);
    }
  }

  if (stage.timeMs == null && stage.parallelUsed == null && stage.label == null) return null;
  return stage;
}

function toMillis(val: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case "ns":
      return val / 1e6;
    case "us":
    case "µs":
      return val / 1e3;
    case "s":
      return val * 1e3;
    default:
      return val; // ms
  }
}

// Attribute lines: "Keys: ...", "Output: ...", "Aggregates: ...", "Skip merging: 0"
function parseAttribute(line: string): [string, string] | null {
  const m = line.match(/^([A-Z][A-Za-z ]+):\s*(.*)$/);
  if (!m) return null;
  const key = m[1].trim();
  const val = m[2].trim();
  if (!val) return null;
  return [key, val];
}

// parseReadTotals matches the top-level MergeTree read-coverage line:
//   "Parts: 2 | Granules: 12"
// (totals available before index filtering). Returns null if not a match.
function parseReadTotals(line: string): { parts: number; granules: number } | null {
  const m = line.match(/^Parts:\s*(\d+)\s*\|\s*Granules:\s*(\d+)/);
  if (!m) return null;
  return { parts: parseInt(m[1], 10), granules: parseInt(m[2], 10) };
}

// parseIndexRatio matches a per-index "Parts: read/total" or
// "Granules: read/total" line. Returns null if the value isn't a ratio
// (e.g. "Ranges: 2" has no slash).
function parseIndexRatio(line: string, field: string): { read: number; total: number } | null {
  const m = line.match(new RegExp(`^${field}:\\s*(\\d+)/(\\d+)`));
  if (!m) return null;
  return { read: parseInt(m[1], 10), total: parseInt(m[2], 10) };
}

// An index-entry name is a bare capitalized token with no colon — e.g.
// "Min-Max", "Partition", "PrimaryKey". Distinguished from attribute lines
// (which contain ":") and from step lines (which start a new plan node).
function isIndexEntryName(line: string): boolean {
  return /^[A-Z][A-Za-z-]+$/.test(line) && !line.includes(":");
}

// Determine a line's "level" by counting leading box-char/whitespace units.
// ├── and └── start a new step at the current depth; │ and spaces indent
// metric/attribute lines deeper. We normalise to a number we can compare.
function stepIndent(line: string): number {
  // Strip leading tree connectors and whitespace; count them as indent.
  let i = 0;
  let n = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " " || ch === "│") {
      i++;
      n++;
    } else if (ch === "├" || ch === "└") {
      // ├── / └── : the connector chars, then ──
      i++;
      n++;
      while (i < line.length && line[i] === "─") i++;
    } else {
      break;
    }
  }
  return n;
}

// A line is a "step" (plan node) if, after stripping the leading connector
// run, it begins with an uppercase letter or word and is NOT one of the
// metric/attribute markers. (Index-entry names inside an Indexes: block are
// reclassified in the first pass before this is consulted — see indexesAt.)
function isStepLine(stripped: string): boolean {
  if (!stripped) return false;
  if (/^(I\/O|Stage|time|parallelism|processors|Keys|Output|Aggregates|Skip|Aggregat)/i.test(stripped)) {
    // "Aggregating" is a real step; "Aggregates:" is an attribute.
    return /^Aggregating/.test(stripped);
  }
  // The summary block lines start with a word + ":" — exclude those.
  if (/^(Query summary|Time|Read|Peak memory):/i.test(stripped)) return false;
  return /^[A-Z]/.test(stripped);
}

function splitLabel(stripped: string): { label: string; detail?: string } {
  // "Expression ((Project names + Projection))" → label "Expression", detail "(...)"
  // Detail may itself contain parens, so match a trailing balanced "(...)".
  const idx = stripped.indexOf("(");
  if (idx > 0 && stripped.endsWith(")")) {
    return {
      label: stripped.slice(0, idx).trim(),
      detail: stripped.slice(idx + 1, -1).trim(),
    };
  }
  return { label: stripped };
}

export function parseAnalyzePlan(raw: string): AnalyzeNode | null {
  const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));
  // Drop the leading "Query summary:" block — it is not part of the tree.
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Query summary")) {
      // Skip until the first blank line after the summary.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") j++;
      start = j + 1;
      break;
    }
  }
  const tree = lines.slice(start);

  // First pass: classify lines into (kind, content, indent).
  type Kind = "step" | "io" | "stage" | "processor" | "attr";
  interface Cls {
    kind: Kind;
    text: string; // connector-stripped, trimmed
    indent: number;
  }
  const cls: Cls[] = [];
  // indexesAt tracks the indent of the most recent "Indexes:" header. While
  // set, bare capitalized words at a deeper indent are index-entry names
  // (Min-Max, Partition, PrimaryKey, ...), not plan steps — without this they'd
  // be misclassified as steps and break out of the owning ReadFromMergeTree.
  let indexesAt: number | null = null;
  for (const raw of tree) {
    if (raw.trim() === "") continue;
    const indent = stepIndent(raw);
    const stripped = raw.slice(raw.length - raw.replace(/^[\s│├└─]+/, "").length).trim();
    if (stripped === "") continue;
    // Close the index block when a line returns to the header's indent or above.
    if (indexesAt != null && indent <= indexesAt) indexesAt = null;

    let kind: Kind;
    if (/^Indexes:/.test(stripped)) {
      kind = "attr";
      indexesAt = indent;
    } else if (/^I\/O:/.test(stripped)) kind = "io";
    else if (/^(Stage|time|parallelism)/i.test(stripped) && !/^Aggregating/.test(stripped)) kind = "stage";
    else if (/^processors/i.test(stripped) || /^[\d.]+\/[\d.]+\/[\d.]+\/[\d.]/.test(stripped)) kind = "processor";
    else if (parseAttribute(stripped)) kind = "attr";
    else if (indexesAt != null && indent > indexesAt) kind = "attr"; // index-entry name
    else if (isStepLine(stripped)) kind = "step";
    else kind = "attr"; // unknown indented line → treat as attribute
    cls.push({ kind, text: stripped, indent });
  }

  // Second pass: build the tree. Steps nest by indent; io/stage/processor/attr
  // attach to the most recent step at a shallower indent. The Indexes: block
  // under a ReadFromMergeTree step is parsed into owner.metrics.indexes via a
  // small state machine: once "Indexes:" is seen on an owner, subsequent
  // index-entry names and their Condition/Parts/Granules lines populate the
  // current IndexUsage until a line at or above the header's indent arrives.
  let nextId = 0;
  const root: AnalyzeNode[] = [];
  const stack: AnalyzeNode[] = []; // steps, ascending by depth
  // indexBlock tracks the active "Indexes:" sub-structure: which owner step
  // it belongs to, the header's indent (to detect block close), and the
  // entry currently receiving Condition/Parts/Granules lines.
  let indexBlock: { owner: AnalyzeNode; headerIndent: number; current?: IndexUsage } | null = null;

  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c.kind === "step") {
      const { label, detail } = splitLabel(c.text);
      const node: AnalyzeNode = {
        id: nextId++,
        label,
        detail,
        attributes: {},
        metrics: { stages: [], indexes: [] },
        children: [],
        depth: c.indent,
      };
      // Pop until we find a parent with shallower indent.
      while (stack.length && stack[stack.length - 1].depth >= c.indent) stack.pop();
      if (stack.length) {
        stack[stack.length - 1].children.push(node);
      } else {
        root.push(node);
      }
      stack.push(node);
    } else {
      const owner = stack[stack.length - 1];
      if (!owner) continue; // stray metric with no enclosing step

      if (c.kind === "io") {
        parseIoLine(c.text, owner.metrics);
        continue;
      }
      if (c.kind === "stage") {
        // A processor line (if any) immediately follows a stage line.
        const next = cls[i + 1];
        const procLine = next && next.kind === "processor" ? next.text : undefined;
        const stage = parseStageLine(c.text, procLine);
        if (stage) owner.metrics.stages.push(stage);
        if (procLine) i++; // consume the processor line
        continue;
      }
      // standalone "processor" lines without a preceding stage are ignored
      if (c.kind === "processor") continue;

      // attr lines: route into the Indexes: state machine when active,
      // otherwise into the flat attributes map.
      const line = c.text;

      // Indexes: header opens the block on this owner.
      if (/^Indexes:/.test(line)) {
        owner.metrics.indexes = owner.metrics.indexes ?? [];
        indexBlock = { owner, headerIndent: c.indent, current: undefined };
        continue;
      }
      if (indexBlock?.owner === owner) {
        // A line at or above the header indent closes the block.
        if (c.indent <= indexBlock.headerIndent) {
          indexBlock = null;
        } else {
          if (isIndexEntryName(line)) {
            // Start a new index entry. (Repeated names, e.g. two "PrimaryKey"
            // runs, are kept in order — the most-restrictive wins on ratio.)
            const entry: IndexUsage = { name: line };
            owner.metrics.indexes.push(entry);
            indexBlock.current = entry;
            continue;
          }
          if (indexBlock.current) {
            const entry = indexBlock.current;
            const kv = parseAttribute(line);
            if (kv) {
              if (kv[0] === "Condition") entry.condition = kv[1];
              else if (kv[0] === "Parts") {
                const r = parseIndexRatio(line, "Parts");
                if (r) { entry.partsRead = r.read; entry.partsTotal = r.total; }
              } else if (kv[0] === "Granules") {
                const r = parseIndexRatio(line, "Granules");
                if (r) { entry.granulesRead = r.read; entry.granulesTotal = r.total; }
              }
            }
            continue;
          }
        }
      }

      // Top-level "Parts: 2 | Granules: 12" (read totals, not per-index).
      const totals = parseReadTotals(line);
      if (totals) {
        owner.metrics.partsTotal = totals.parts;
        owner.metrics.granulesTotal = totals.granules;
        continue;
      }

      // Default: flat attribute (Keys:, Output:, Read type:, ...).
      const kv = parseAttribute(line);
      if (kv) owner.attributes[kv[0]] = kv[1];
    }
    // Close the index block when ownership moves to a different step.
    if (c.kind === "step" && indexBlock && indexBlock.owner !== stack[stack.length - 1]) {
      indexBlock = null;
    }
  }

  return root.length ? root[0] : null; // single root step
}

// granuleSkipEffect computes how effectively the MergeTree indexes pruned the
// read. ClickHouse applies indexes in sequence and the MOST RESTRICTIVE one
// (lowest granulesRead/granulesTotal ratio) determines the actual read set,
// so we report that index's ratio. Returns null when there's no index data —
// e.g. a full scan, a ReadFromSystemNumbers step, or older ANALYZE output
// without the Indexes block.
export function granuleSkipEffect(node: AnalyzeNode): {
  read: number;
  total: number;
  skippedPct: number;
  source: string;
} | null {
  const usable = node.metrics.indexes.filter(
    (ix) => ix.granulesRead != null && ix.granulesTotal != null && ix.granulesTotal > 0,
  );
  if (usable.length === 0) return null;

  // Lowest surviving ratio = most restrictive index.
  let best = usable[0];
  for (const ix of usable) {
    if (ix.granulesRead! / ix.granulesTotal! < best.granulesRead! / best.granulesTotal!) {
      best = ix;
    }
  }
  const read = best.granulesRead!;
  const total = best.granulesTotal!;
  return {
    read,
    total,
    skippedPct: (1 - read / total) * 100,
    source: best.name,
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

// A node is a "hotspot" if any stage exceeds this share of query time.
const HOTSPOT_PCT = 20;

function SelectivityBadge({ selectivity }: { selectivity?: number }) {
  if (selectivity == null || !Number.isFinite(selectivity)) return null;
  // Low selectivity (heavy filtering) is worth flagging; >1 means row expansion.
  const pct = selectivity * 100;
  let cls = "text-[var(--color-text-secondary)]";
  if (pct > 0 && pct < 1) cls = "text-[var(--color-warning)]";
  else if (pct === 0) cls = "text-[var(--color-error)]";
  return <span className={`text-[10px] ${cls}`}>({pct < 0.01 ? pct.toFixed(2) : pct.toFixed(1)}%)</span>;
}

// GranuleSkipCallout surfaces the single most actionable MergeTree read fact:
// how much of the table the indexes pruned vs. read. Rendered only on
// ReadFromMergeTree steps with index data. The tone follows effectiveness —
// green when pruning helped, red when nothing was skipped, amber in between.
function GranuleSkipCallout({ node }: { node: AnalyzeNode }) {
  const effect = granuleSkipEffect(node);
  if (!effect) return null;

  const { read, total, skippedPct, source } = effect;
  // Thresholds: ≥50% skipped is good; <10% on a non-trivial read is suspect.
  const trivial = total < 10;
  let tone: "good" | "warn" | "bad";
  let icon: string;
  let msg: string;
  if (skippedPct >= 50) {
    tone = "good";
    icon = "✓";
    msg = `index pruned ${skippedPct.toFixed(0)}% of granules (${read}/${total} read, via ${source})`;
  } else if (skippedPct === 0) {
    tone = "bad";
    icon = "✗";
    msg = `read all ${total} granules — no index pruning${trivial ? "" : " (WHERE may not match the primary/order key)"}`;
  } else {
    tone = trivial ? "warn" : "warn";
    icon = "⚠";
    msg = `index barely pruned: ${skippedPct.toFixed(0)}% of ${total} granules skipped${trivial ? "" : " — WHERE may not match the primary/order key"}`;
  }
  const toneColor =
    tone === "good" ? "var(--color-success)" : tone === "bad" ? "var(--color-error)" : "var(--color-warning)";
  const bg =
    tone === "good" ? "var(--color-success)" : tone === "bad" ? "var(--color-error)" : "var(--color-warning)";

  return (
    <div
      className="mt-1 rounded border px-2 py-1 text-[11px]"
      style={{ borderColor: `color-mix(in srgb, ${bg} 40%, transparent)`, backgroundColor: `color-mix(in srgb, ${bg} 8%, transparent)` }}
    >
      <span className="font-semibold" style={{ color: toneColor }}>{icon}</span>{" "}
      <span style={{ color: toneColor }}>{msg}</span>
    </div>
  );
}

function ParallelismChip({ stage }: { stage: StageMetrics }) {
  if (stage.parallelUsed == null || stage.parallelMax == null) return null;
  const ratio = stage.parallelMax > 0 ? stage.parallelUsed / stage.parallelMax : 0;
  // Red when a multi-thread-capable stage runs nearly serially.
  const serial = stage.parallelMax >= 2 && ratio < 0.4;
  const cls = serial
    ? "text-[var(--color-error)]"
    : ratio > 0.7
      ? "text-[var(--color-success)]"
      : "text-[var(--color-text-secondary)]";
  return (
    <span className={`text-[10px] ${cls}`}>
      · parallelism {stage.parallelUsed.toFixed(2)}/{stage.parallelMax}
    </span>
  );
}

function StageLine({ stage }: { stage: StageMetrics }) {
  return (
    <div className="text-[var(--color-text-secondary)]">
      {stage.label && <span className="text-[var(--color-text-primary)]">Stage ({stage.label}): </span>}
      {stage.timeMs != null && (
        <span className={stage.timePct != null && stage.timePct >= HOTSPOT_PCT ? "text-[var(--color-error)] font-semibold" : ""}>
          time {formatDuration(stage.timeMs)}
          {stage.timePct != null && ` (${stage.timePct.toFixed(1)}%)`}
        </span>
      )}{" "}
      <ParallelismChip stage={stage} />
      {stage.procMaxMs != null && stage.procMedianMs != null && (
        <span className="text-[10px] text-[var(--color-text-secondary)]">
          {" "}· processors min/med/max {formatDuration(stage.procMinMs ?? 0)}/{formatDuration(stage.procMedianMs)}/{formatDuration(stage.procMaxMs)}
          {stage.procMaxMs > 0 && stage.procMedianMs > 0 && stage.procMaxMs / stage.procMedianMs > 3 && (
            <span className="text-[var(--color-warning)]"> (skewed)</span>
          )}
        </span>
      )}
    </div>
  );
}

function AnalyzeTreeNode({ node, defaultExpanded }: { node: AnalyzeNode; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children.length > 0;
  const toggle = useCallback(() => setExpanded((e) => !e), []);
  const m = node.metrics;
  const ioLine =
    m.rowsIn != null || m.rowsOut != null
      ? `rows ${m.rowsIn != null ? formatNumber(m.rowsIn) : "?"} → ${m.rowsOut != null ? formatNumber(m.rowsOut) : "?"}`
      : null;
  const bytesLine =
    m.bytesIn != null || m.bytesOut != null
      ? `${m.bytesIn != null ? formatBytes(m.bytesIn) : "?"} → ${m.bytesOut != null ? formatBytes(m.bytesOut) : "?"}`
      : null;

  return (
    <div className="font-mono text-xs">
      <div
        role="button"
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        className={`flex items-start gap-1 rounded px-2 py-1 hover:bg-[var(--color-bg-primary)] ${hasChildren ? "cursor-pointer" : ""}`}
        onClick={hasChildren ? toggle : undefined}
        onKeyDown={hasChildren ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined}
      >
        <span className="mt-0.5 w-3.5 shrink-0 text-center">
          {hasChildren ? (
            expanded ? <ChevronDown className="h-3 w-3 text-[var(--color-text-secondary)]" /> : <ChevronRight className="h-3 w-3 text-[var(--color-text-secondary)]" />
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
        </span>
        <span className="font-semibold text-[var(--color-text-primary)]">{node.label}</span>
        {node.detail && <span className="ml-1 text-[var(--color-text-secondary)]">({node.detail})</span>}
        <SelectivityBadge selectivity={m.selectivity} />
        {hasChildren && <span className="ml-1 text-[var(--color-text-secondary)] opacity-50">{node.children.length}</span>}
      </div>

      {/* Attributes + metrics live at a deeper indent, shown when this node is "open". */}
      <div className="ml-5 border-l border-[var(--color-border)] pl-3">
        {/* Prominent index-pruning callout for MergeTree reads — the most
            actionable read-performance fact. Rendered above the raw attributes
            (which still show the full Indexes: detail below). */}
        {node.label === "ReadFromMergeTree" && <GranuleSkipCallout node={node} />}
        {Object.entries(node.attributes).map(([k, v]) => (
          <div key={k} className="text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-text-primary)]">{k}:</span> {v}
          </div>
        ))}
        {ioLine && (
          <div className="text-[var(--color-text-secondary)]">
            I/O: {ioLine} <SelectivityBadge selectivity={m.selectivity} />
            {bytesLine && <span> · {bytesLine}</span>}
          </div>
        )}
        {m.stages.map((s, i) => (
          <div key={i} className="pl-2">
            <StageLine stage={s} />
          </div>
        ))}
      </div>

      {expanded && hasChildren && (
        <div className="ml-4 border-l border-[var(--color-border)] pl-1">
          {node.children.map((child) => (
            <AnalyzeTreeNode key={child.id} node={child} defaultExpanded={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({ s }: { s: ExplainAnalyze["summary"] }) {
  const hasSummary =
    s && (s.total_ms || s.read_rows || s.read_bytes || s.peak_memory);
  if (!hasSummary) return null;
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 sm:grid-cols-4">
      {s.total_ms != null && (
        <div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">Total time</div>
          <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">
            {formatDuration(s.total_ms)}
          </div>
          {s.planning_ms != null && s.execution_ms != null && (
            <div className="text-[10px] text-[var(--color-text-secondary)]">
              plan {formatDuration(s.planning_ms)} · exec {formatDuration(s.execution_ms)}
            </div>
          )}
        </div>
      )}
      {s.read_rows != null && (
        <div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">Rows read</div>
          <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">{formatNumber(s.read_rows)}</div>
          {s.rows_per_sec != null && (
            <div className="text-[10px] text-[var(--color-text-secondary)]">{formatNumber(s.rows_per_sec)}/s</div>
          )}
        </div>
      )}
      {s.read_bytes != null && (
        <div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">Data read</div>
          <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">{formatBytes(s.read_bytes)}</div>
          {s.bytes_per_sec != null && (
            <div className="text-[10px] text-[var(--color-text-secondary)]">{formatBytes(s.bytes_per_sec)}/s</div>
          )}
        </div>
      )}
      {s.peak_memory != null && (
        <div>
          <div className="text-[10px] text-[var(--color-text-secondary)]">Peak memory</div>
          <div className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">{formatBytes(s.peak_memory)}</div>
        </div>
      )}
    </div>
  );
}

export function AnalyzePlanTree({ result }: { result: ExplainAnalyze }) {
  const tree = parseAnalyzePlan(result.raw);

  return (
    <div>
      <SummaryStrip s={result.summary} />
      {tree ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <AnalyzeTreeNode node={tree} defaultExpanded={true} />
        </div>
      ) : (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--color-text-primary)]">
          {result.raw}
        </pre>
      )}
    </div>
  );
}
