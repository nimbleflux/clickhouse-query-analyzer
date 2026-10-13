import type { SchemaGraphData, SchemaGraphEdge, SchemaGraphNode, SchemaKind, HeatMetric } from "@/api/types";

/**
 * Pure DOT generation for the schema graph. No DOM access — colors arrive as
 * a resolved GraphTheme (the view reads CSS vars at render time and
 * re-renders on theme change, the FlameGraph pattern), which keeps this
 * module unit-testable.
 */

/** Graph-wide unique node identifier ("database.name"). */
export function nodeKey(n: Pick<SchemaGraphNode, "database" | "name">): string {
  return n.database + "." + n.name;
}

export interface GraphTheme {
  cardBg: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  font: string;
  light: boolean;
}

/** Stable hue per engine kind — the visual identity of the graph. */
export const KIND_HUES: Record<SchemaKind, string> = {
  mergetree: "#3b82f6", // blue
  mv: "#a855f7", // purple
  rmv: "#ec4899", // pink
  dictionary: "#f59e0b", // amber
  distributed: "#f97316", // orange
  view: "#14b8a6", // teal
  remote: "#f43f5e", // rose — remote/object-storage engines
  other: "#64748b", // slate
};

export const KIND_LABELS: Record<SchemaKind, string> = {
  mergetree: "MergeTree",
  mv: "MaterializedView",
  rmv: "Refreshable MV",
  dictionary: "Dictionary",
  distributed: "Distributed",
  view: "View",
  remote: "Remote",
  other: "Other",
};

/** blue → green → amber → red ramp for the MV load heat-map. */
export const HEAT_RAMP = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

export function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(0.9999, t));
  return HEAT_RAMP[Math.floor(clamped * HEAT_RAMP.length)];
}

/** Linear interpolation between two #rrggbb colors. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const mix = pa.map((av, i) => Math.round(av + (pb[i] - av) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): number[] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Escape text that goes inside a graphviz HTML-like label. */
export function escapeHtmlLabel(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape a value for a quoted DOT identifier. */
export function escapeDotId(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(n);
  const units = ["K", "M", "B", "T"];
  let v = n;
  let u = -1;
  do { v /= 1000; u++; } while (v >= 1000 && u < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${units[u]}`;
}

export function fmtBytesCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n;
  let u = -1;
  do { v /= 1024; u++; } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(1)} ${units[u]}`;
}

// ---------------------------------------------------------------------------
// DOT generation
// ---------------------------------------------------------------------------

export interface DotOptions {
  theme: GraphTheme;
  /** Engine kinds currently visible (legend toggles). */
  visibleKinds: Set<SchemaKind>;
  /** When set, only tables of this database are shown. */
  dbFilter: string | null;
  /** Normalized 0..1 heat per MV node key (from system.query_views_log). */
  heat: Map<string, number>;
}

/** Which query_views_log metric the heat-map colors by. */
export function loadValue(
  l: { executions: number; total_duration_ms: number; total_written_rows: number; total_written_bytes: number; total_read_rows: number; total_read_bytes: number; peak_memory_usage: number },
  metric: HeatMetric,
): number {
  switch (metric) {
    case "executions": return l.executions;
    case "written_rows": return l.total_written_rows;
    case "written_bytes": return l.total_written_bytes;
    case "read_rows": return l.total_read_rows;
    case "read_bytes": return l.total_read_bytes;
    case "peak_memory": return l.peak_memory_usage;
    default: return l.total_duration_ms;
  }
}

/** Normalize raw load rows into a 0..1 heat per node key (log-scaled) for the chosen metric. */
export function computeHeat(
  graph: Pick<SchemaGraphData, "load" | "nodes">,
  metric: HeatMetric = "duration",
): Map<string, number> {
  const out = new Map<string, number>();
  if (!graph.load || graph.load.length === 0) return out;
  const max = Math.max(...graph.load.map((l) => Math.max(1, loadValue(l, metric))));
  for (const l of graph.load) {
    // view_name in query_views_log may be qualified or bare; match on suffix.
    const node = graph.nodes.find(
      (n) => n.name === l.view || `${n.database}.${n.name}` === l.view,
    );
    if (!node) continue;
    const t = Math.log1p(Math.max(0, loadValue(l, metric))) / Math.log1p(max);
    out.set(nodeKey(node), Math.max(0, Math.min(1, t)));
  }
  return out;
}

/** Max column rows rendered inside a node card (ClickHouse's uses 14). */
export const MAX_NODE_LABEL_COLUMNS = 12;

function nodeLabel(node: SchemaGraphNode, opts: DotOptions): string {
  const { theme } = opts;
  const hue = KIND_HUES[node.kind] ?? KIND_HUES.other;
  const heat = opts.heat.get(nodeKey(node));
  const headerBg =
    heat !== undefined ? mixHex(theme.cardBg, heatColor(heat), 0.55) : mixHex(theme.cardBg, hue, 0.16);
  const rowBg = mixHex(theme.cardBg, hue, 0.05);
  const name = escapeHtmlLabel(node.name);
  const kindLabel = escapeHtmlLabel(KIND_LABELS[node.kind] ?? node.kind);
  const stats = [
    node.total_rows > 0 ? `${fmtCompact(node.total_rows)} row${node.total_rows === 1 ? "" : "s"}` : "",
    node.total_bytes > 0 ? fmtBytesCompact(node.total_bytes) : "",
  ].filter(Boolean).join(" · ");

  const keyColor = mixHex(theme.light ? "#000000" : "#ffffff", "#ef4444", 0.75);
  const cols = (node.columns ?? []).slice(0, MAX_NODE_LABEL_COLUMNS);
  const hidden = (node.columns?.length ?? 0) - cols.length + (node.columns_truncated ? 1 : 0);

  const columnRows = cols
    .map((c) => {
      const nameColor = c.in_key ? keyColor : theme.textPrimary;
      const nameWeight = c.in_key ? "<B>" : "";
      const nameEnd = c.in_key ? "</B>" : "";
      return `<TR>
    <TD BGCOLOR="${rowBg}" WIDTH="3"></TD>
    <TD BGCOLOR="${rowBg}" ALIGN="LEFT"><FONT COLOR="${nameColor}" POINT-SIZE="9">${nameWeight} ${escapeHtmlLabel(c.name)} ${nameEnd}</FONT></TD>
    <TD BGCOLOR="${rowBg}" ALIGN="RIGHT"><FONT COLOR="${theme.textSecondary}" POINT-SIZE="8"><I> ${escapeHtmlLabel(c.type)} </I></FONT></TD>
  </TR>`;
    })
    .join("\n");
  const moreRow =
    hidden > 0
      ? `<TR>
    <TD BGCOLOR="${rowBg}" WIDTH="3"></TD>
    <TD BGCOLOR="${rowBg}" COLSPAN="2" ALIGN="LEFT"><FONT POINT-SIZE="8" COLOR="${theme.textSecondary}"><I> … ${hidden} more </I></FONT></TD>
  </TR>`
      : "";
  const columnsBlock =
    cols.length > 0
      ? `<HR/>${columnRows}${moreRow ? moreRow : ""}`
      : "";

  const statsRow = stats
    ? `<TR><TD BGCOLOR="${rowBg}" WIDTH="3"></TD><TD COLSPAN="2" ALIGN="LEFT" BGCOLOR="${rowBg}"><FONT POINT-SIZE="9" COLOR="${theme.textSecondary}"> ${escapeHtmlLabel(stats)} </FONT></TD></TR>`
    : "";

  return `<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4">
  <TR>
    <TD BGCOLOR="${hue}" WIDTH="3" VALIGN="MIDDLE"></TD>
    <TD BGCOLOR="${headerBg}" ALIGN="LEFT"><FONT COLOR="${theme.textPrimary}" POINT-SIZE="11"><B> ${name} </B></FONT></TD>
    <TD BGCOLOR="${headerBg}" ALIGN="RIGHT"><FONT COLOR="${theme.textSecondary}" POINT-SIZE="9"><I> ${kindLabel} </I></FONT></TD>
  </TR>
  ${columnsBlock}
  ${statsRow}
</TABLE>>`;
}

function edgeAttr(kind: SchemaGraphEdge["kind"], theme: GraphTheme): string {
  // Colors carry the kind identity; line style distinguishes relation types.
  const styleMap: Record<SchemaGraphEdge["kind"], string> = {
    mv: "",
    dict: ", style=dotted",
    distributed: ", style=dashed",
    view: ", style=dashed",
  };
  return `[color="${theme.textSecondary}" fontcolor="${theme.textSecondary}"${styleMap[kind]}]`;
}

/**
 * Build the graphviz DOT source for the (already filtered) graph.
 * Nodes are grouped into one dashed cluster per database; edges use the
 * standard "from -> to" titles so the view can map rendered SVG elements
 * back to entities.
 */
export function buildDot(graph: Pick<SchemaGraphData, "nodes" | "edges">, opts: DotOptions): string {
  const nodes = graph.nodes.filter(
    (n) => opts.visibleKinds.has(n.kind) && (!opts.dbFilter || n.database === opts.dbFilter),
  );
  const present = new Set(nodes.map(nodeKey));
  const edges = graph.edges.filter((e) => present.has(e.from) && present.has(e.to));

  const byDb = new Map<string, SchemaGraphNode[]>();
  for (const n of nodes) {
    const list = byDb.get(n.database) || [];
    list.push(n);
    byDb.set(n.database, list);
  }

  const lines: string[] = [
    "digraph schema {",
    '  rankdir=LR;',
    '  bgcolor="transparent";',
    '  compound=true;',
    `  fontname="${escapeDotId(opts.theme.font)}";`,
    "  node [shape=plaintext fontsize=11];",
    "  edge [arrowsize=0.7 penwidth=1.3];",
  ];

  let cluster = 0;
  for (const [db, tables] of [...byDb.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const totalRows = tables.reduce((sum, t) => sum + t.total_rows, 0);
    lines.push(`  subgraph cluster_${cluster++} {`);
    lines.push(`    label=<<B> ${escapeHtmlLabel(db)} </B><FONT POINT-SIZE="9" COLOR="${opts.theme.textSecondary}"> ${fmtCompact(totalRows)} rows </FONT>>;`);
    lines.push(`    style="rounded,dashed";`);
    lines.push(`    color="${opts.theme.border}";`);
    lines.push(`    fontcolor="${opts.theme.textPrimary}";`);
    lines.push(`    margin=14;`);
    for (const t of tables) {
      lines.push(`    "${escapeDotId(nodeKey(t))}" [label=${nodeLabel(t, opts)}];`);
    }
    lines.push("  }");
  }

  for (const e of edges) {
    lines.push(`  "${escapeDotId(e.from)}" -> "${escapeDotId(e.to)}" ${edgeAttr(e.kind, opts.theme)};`);
  }

  lines.push("}");
  return lines.join("\n");
}

/** Adjacency map for click-to-highlight (key → connected keys). */
export function buildAdjacency(edges: SchemaGraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    adj.get(e.to)!.add(e.from);
  }
  return adj;
}
