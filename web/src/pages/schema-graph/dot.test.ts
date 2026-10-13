import { describe, it, expect } from "vitest";
import {
  escapeHtmlLabel,
  escapeDotId,
  mixHex,
  fmtCompact,
  fmtBytesCompact,
  buildDot,
  buildAdjacency,
  computeHeat,
  KIND_HUES,
  type GraphTheme,
} from "./dot";
import type { SchemaGraphData } from "@/api/types";

const theme: GraphTheme = {
  cardBg: "#1a1d23",
  border: "#2a2e36",
  textPrimary: "#e6e8eb",
  textSecondary: "#9aa1ab",
  font: "Inter, sans-serif",
  light: false,
};

const fixture: SchemaGraphData = {
  nodes: [
    { database: "analytics", name: "events", engine: "MergeTree", kind: "mergetree", total_rows: 10000, total_bytes: 450322 },
    { database: "analytics", name: "events_daily_mv", engine: "MaterializedView", kind: "mv", total_rows: 30, total_bytes: 1024 },
    { database: "analytics", name: "events_daily", engine: "SummingMergeTree", kind: "mergetree", total_rows: 30, total_bytes: 2048 },
  ],
  edges: [
    { from: "analytics.events", to: "analytics.events_daily_mv", kind: "mv" },
    { from: "analytics.events_daily_mv", to: "analytics.events_daily", kind: "mv" },
  ],
  databases: [{ database: "analytics", tables: 3 }],
  truncated: false,
};

describe("escapeHtmlLabel", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtmlLabel("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
  it("leaves plain names alone", () => {
    expect(escapeHtmlLabel("events_daily")).toBe("events_daily");
  });
});

describe("escapeDotId", () => {
  it("escapes quotes and backslashes inside quoted identifiers", () => {
    expect(escapeDotId('we"ird\\name')).toBe('we\\"ird\\\\name');
  });
});

describe("mixHex", () => {
  it("returns the first color at t=0", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
  });
  it("returns the second color at t=1", () => {
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
  });
  it("midpoint of black and white is gray", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("formatters", () => {
  it("compacts counts", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(10000)).toBe("10.0K");
    expect(fmtCompact(2500000)).toBe("2.5M");
  });
  it("compacts bytes", () => {
    expect(fmtBytesCompact(512)).toBe("512 B");
    expect(fmtBytesCompact(450322)).toBe("439.8 KiB");
  });
});

describe("buildDot", () => {
  const dot = buildDot(fixture, {
    theme,
    visibleKinds: new Set(["mergetree", "mv", "rmv", "dictionary", "distributed", "view", "remote", "other"]),
    dbFilter: null,
    heat: new Map(),
  });

  it("wraps the graph and sets left-to-right ranking", () => {
    expect(dot.startsWith("digraph schema {")).toBe(true);
    expect(dot).toContain("rankdir=LR;");
  });

  it("emits one cluster per database with a dashed style", () => {
    expect(dot).toContain("subgraph cluster_0");
    expect(dot).toContain('style="rounded,dashed"');
    expect(dot).toContain("analytics");
  });

  it("renders HTML-like table labels with escaped names", () => {
    expect(dot).toContain("<<TABLE");
    expect(dot).toContain("events_daily_mv");
    expect(dot).toContain(`BGCOLOR="${KIND_HUES.mv}"`);
  });

  it("emits edges as quoted from -> to pairs with titles intact", () => {
    expect(dot).toContain('"analytics.events" -> "analytics.events_daily_mv"');
  });

  it("drops edges whose endpoints are filtered out", () => {
    const dot = buildDot(fixture, {
      theme,
      visibleKinds: new Set(["mv"]), // hides both mergetree tables
      dbFilter: null,
      heat: new Map(),
    });
    expect(dot).not.toContain("->");
    expect(dot).toContain("events_daily_mv");
    expect(dot).not.toContain('"analytics.events"');
  });

  it("filters by database", () => {
    const wide: SchemaGraphData = {
      nodes: [...fixture.nodes, { database: "shop", name: "orders", engine: "MergeTree", kind: "mergetree", total_rows: 5, total_bytes: 5 }],
      edges: [],
      databases: [{ database: "analytics", tables: 3 }, { database: "shop", tables: 1 }],
      truncated: false,
    };
    const dot = buildDot(wide, { theme, visibleKinds: new Set(["mergetree", "mv"]), dbFilter: "shop", heat: new Map() });
    expect(dot).toContain("shop");
    expect(dot).not.toContain("events_daily_mv");
  });

  it("escapes quotes coming from table names", () => {
    const weird: SchemaGraphData = {
      nodes: [{ database: "db", name: 'we"ird', engine: "Memory", kind: "other", total_rows: 0, total_bytes: 0 }],
      edges: [],
      databases: [{ database: "db", tables: 1 }],
      truncated: false,
    };
    const dot = buildDot(weird, { theme, visibleKinds: new Set(["other"]), dbFilter: null, heat: new Map() });
    expect(dot).toContain('"db.we\\"ird"');
    // The HTML label must carry the escaped-less name (HTML escaping only).
    expect(dot).toContain("we&quot;ird");
  });
});

describe("buildAdjacency", () => {
  it("links both directions", () => {
    const adj = buildAdjacency(fixture.edges);
    expect(adj.get("analytics.events")?.has("analytics.events_daily_mv")).toBe(true);
    expect(adj.get("analytics.events_daily_mv")?.has("analytics.events")).toBe(true);
    expect(adj.get("analytics.events_daily")?.has("analytics.events_daily_mv")).toBe(true);
  });
});

describe("computeHeat", () => {
  it("normalizes durations log-scaled into 0..1", () => {
    const heat = computeHeat({
      nodes: fixture.nodes,
      load: [{ view: "events_daily_mv", executions: 10, total_duration_ms: 5000 }],
    });
    expect(heat.get("analytics.events_daily_mv")).toBeGreaterThan(0);
    expect(heat.get("analytics.events_daily_mv")).toBeLessThanOrEqual(1);
  });
  it("ignores views with no matching node", () => {
    const heat = computeHeat({ nodes: fixture.nodes, load: [{ view: "ghost", executions: 1, total_duration_ms: 10 }] });
    expect(heat.size).toBe(0);
  });
});
