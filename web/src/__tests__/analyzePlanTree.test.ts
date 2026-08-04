import { describe, it, expect } from "vitest";
import { parseAnalyzePlan, granuleSkipEffect } from "../components/AnalyzePlanTree";

// Canonical example adapted from the ClickHouse EXPLAIN ANALYZE docs.
const DOCS_EXAMPLE = `Query summary:
  Time:        10.72 ms (planning 6.45 ms · execution 4.26 ms)
  Read:        1.00 million rows, 8.00 MB (234.49 million rows/s., 1.88 GB/s.)
  Peak memory: 28.98 KiB

Expression ((Project names + Projection))
│  I/O: rows 10 → 10 · 90 B → 90 B
│    time 21.82 us (0.5%) · parallelism 0.98/1
└──Aggregating
   │  Keys: number MOD 10
   │  Aggregates: count()
   │  Skip merging: 0
   │  I/O: rows 1.00 million → 10 (0.00%) · 1.00 MB → 90 B
   │    Stage (partial aggregation): time 868.45 us (20.4%) · parallelism 3.80/15
   │    Stage (final aggregation): time 445.27 us (10.4%) · parallelism 1.11/16
   └──Expression ((Before GROUP BY + Change column names to column identifiers))
      │  I/O: rows 1.00 million → 1.00 million · 8.00 MB → 1.00 MB
      │    time 677.07 us (15.9%) · parallelism 4.31/15
      └──ReadFromSystemNumbers
            Output: number
            I/O: rows 0 → 1.00 million · 0 B → 8.00 MB
              time 993.94 us (23.3%) · parallelism 7.52/15
`;

describe("parseAnalyzePlan", () => {
  it("returns null for empty input", () => {
    expect(parseAnalyzePlan("")).toBeNull();
    expect(parseAnalyzePlan("Query summary:\n  Time: 5 ms\n")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseAnalyzePlan("this is not a plan\nat all")).toBeNull();
  });

  it("parses the root step and its label/detail", () => {
    const root = parseAnalyzePlan(DOCS_EXAMPLE)!;
    expect(root.label).toBe("Expression");
    // Detail is the content between the outermost parens; the renderer wraps
    // it in () again, reconstructing the original "((Project names + ...))".
    expect(root.detail).toBe("(Project names + Projection)");
  });

  it("builds the nested tree structure", () => {
    const root = parseAnalyzePlan(DOCS_EXAMPLE)!;
    expect(root.children).toHaveLength(1);
    const agg = root.children[0];
    expect(agg.label).toBe("Aggregating");
    expect(agg.children).toHaveLength(1);
    expect(agg.children[0].label).toBe("Expression");
    expect(agg.children[0].children[0].label).toBe("ReadFromSystemNumbers");
  });

  it("captures I/O rows in/out, bytes, and selectivity", () => {
    const root = parseAnalyzePlan(DOCS_EXAMPLE)!;
    const agg = root.children[0];
    expect(agg.metrics.rowsIn).toBe(1_000_000);
    expect(agg.metrics.rowsOut).toBe(10);
    expect(agg.metrics.selectivity).toBeCloseTo(0, 5); // (0.00%)
    expect(agg.metrics.bytesIn).toBe(1024 * 1024); // 1.00 MB
    expect(agg.metrics.bytesOut).toBe(90); // 90 B

    // Root has a passthrough I/O (10 → 10), so selectivity is ~1.
    expect(root.metrics.rowsIn).toBe(10);
    expect(root.metrics.rowsOut).toBe(10);
  });

  it("parses single-stage steps (time line without a Stage label)", () => {
    const root = parseAnalyzePlan(DOCS_EXAMPLE)!;
    expect(root.metrics.stages).toHaveLength(1);
    const stage = root.metrics.stages[0];
    expect(stage.label).toBeUndefined();
    expect(stage.timeMs).toBeCloseTo(0.02182, 4); // 21.82 us → ms
    expect(stage.timePct).toBe(0.5);
    expect(stage.parallelUsed).toBeCloseTo(0.98, 2);
    expect(stage.parallelMax).toBe(1);
  });

  it("parses multi-stage steps with stage labels", () => {
    const agg = parseAnalyzePlan(DOCS_EXAMPLE)!.children[0];
    expect(agg.metrics.stages).toHaveLength(2);
    const [partial, final] = agg.metrics.stages;
    expect(partial.label).toBe("partial aggregation");
    expect(partial.timePct).toBe(20.4);
    expect(partial.parallelMax).toBe(15);
    expect(final.label).toBe("final aggregation");
    expect(final.timePct).toBe(10.4);
    expect(final.parallelMax).toBe(16);
  });

  it("captures attribute lines (Keys, Output, Aggregates, Skip merging)", () => {
    const agg = parseAnalyzePlan(DOCS_EXAMPLE)!.children[0];
    expect(agg.attributes["Keys"]).toBe("number MOD 10");
    expect(agg.attributes["Aggregates"]).toBe("count()");
    expect(agg.attributes["Skip merging"]).toBe("0");

    const reader = agg.children[0].children[0];
    expect(reader.attributes["Output"]).toBe("number");
  });

  it("parses per-processor distribution when present (processors=1)", () => {
    const raw = `Query summary:
  Time:        10 ms

Aggregating
│  I/O: rows 100 → 10 (10.00%)
│    Stage (partial aggregation): time 868.45 us (20.4%) · parallelism 3.80/15
│      processors: 1.23/4.56/7.89/13.57 ms
`;
    const agg = parseAnalyzePlan(raw)!;
    const stage = agg.metrics.stages[0];
    expect(stage.procMinMs).toBeCloseTo(1.23, 2);
    expect(stage.procMedianMs).toBeCloseTo(4.56, 2);
    expect(stage.procMaxMs).toBeCloseTo(7.89, 2);
    expect(stage.procSumMs).toBeCloseTo(13.57, 2);
  });

  it("treats Aggregating as a step but Aggregates: as an attribute", () => {
    const raw = `Query summary:
  Time: 1 ms

Aggregating
│  Aggregates: count()
`;
    const root = parseAnalyzePlan(raw)!;
    expect(root.label).toBe("Aggregating");
    expect(root.attributes["Aggregates"]).toBe("count()");
  });

  it("is tolerant of a missing summary block", () => {
    const raw = `Expression ((Projection))
│  I/O: rows 1 → 1
`;
    const root = parseAnalyzePlan(raw)!;
    expect(root.label).toBe("Expression");
    expect(root.metrics.rowsIn).toBe(1);
  });
});

// Real ReadFromMergeTree output with a multi-index block, captured from a
// ClickHouse 26.7 EXPLAIN ANALYZE run. The PrimaryKey pruned 9 of 12 granules.
const MERGETREE_EXAMPLE = `Query summary:
  Time:        11.43 ms

ReadFromMergeTree (analytics.events)
      Read type: Default
      Parts: 2 | Granules: 12
      Output: event_type
      Indexes:
        Min-Max
          Condition: true
          Parts: 2/2
          Granules: 12/12
        Partition
          Condition: true
          Parts: 2/2
          Granules: 12/12
        PrimaryKey
          Condition: true
          Parts: 2/2
          Granules: 3/12
        Ranges: 2
      I/O: rows 0 → 100.00 thousand · 0 B → 100.17 KB
        time 11.43 ms (60.9%) · parallelism 1.64/2
`;

// Helper: descend to the first ReadFromMergeTree node in a tree.
function findMergeTree(node: { label: string; children: any[] }): any | null {
  if (node.label === "ReadFromMergeTree") return node;
  for (const c of node.children) {
    const found = findMergeTree(c);
    if (found) return found;
  }
  return null;
}

describe("ReadFromMergeTree index parsing", () => {
  it("parses the top-level Parts/Granules totals", () => {
    const root = parseAnalyzePlan(MERGETREE_EXAMPLE)!;
    const mt = findMergeTree(root)!;
    expect(mt.metrics.partsTotal).toBe(2);
    expect(mt.metrics.granulesTotal).toBe(12);
  });

  it("parses each index entry with its parts/granules ratios", () => {
    const root = parseAnalyzePlan(MERGETREE_EXAMPLE)!;
    const mt = findMergeTree(root)!;
    // 3 named indexes: Min-Max, Partition, PrimaryKey. ("Ranges: 2" is a
    // summary count with a colon+value, so it's an attribute, not an entry.)
    expect(mt.metrics.indexes).toHaveLength(3);
    const byName = Object.fromEntries(mt.metrics.indexes.map((ix: any) => [ix.name, ix]));
    expect(byName["Min-Max"].granulesRead).toBe(12);
    expect(byName["Min-Max"].granulesTotal).toBe(12);
    expect(byName["Partition"].partsRead).toBe(2);
    expect(byName["PrimaryKey"].granulesRead).toBe(3);
    expect(byName["PrimaryKey"].granulesTotal).toBe(12);
    expect(byName["PrimaryKey"].condition).toBe("true");
  });

  it("does NOT collide per-index Granules values (the bug this fixes)", () => {
    // Before the fix, repeated Parts:/Granules: keys collided in the flat
    // attributes map and only the last index's values survived.
    const root = parseAnalyzePlan(MERGETREE_EXAMPLE)!;
    const mt = findMergeTree(root)!;
    const mins = mt.metrics.indexes.filter((ix: any) => ix.name === "Min-Max");
    const pks = mt.metrics.indexes.filter((ix: any) => ix.name === "PrimaryKey");
    expect(mins[0].granulesTotal).toBe(12);
    expect(mins[0].granulesRead).toBe(12);
    expect(pks[0].granulesTotal).toBe(12);
    expect(pks[0].granulesRead).toBe(3); // distinct from Min-Max's 12
  });

  it("returns no indexes for ReadFromSystemNumbers (no MergeTree)", () => {
    // The DOCS_EXAMPLE ends in ReadFromSystemNumbers, which has no Indexes block.
    const root = parseAnalyzePlan(DOCS_EXAMPLE)!;
    const reader = findMergeTree(root);
    // findMergeTree returns null because the label is ReadFromSystemNumbers.
    expect(reader).toBeNull();
    // The actual leaf node has no indexes:
    function findLeaf(node: any): any {
      if (node.children.length === 0) return node;
      return findLeaf(node.children[0]);
    }
    expect(findLeaf(root).metrics.indexes).toEqual([]);
  });
});

describe("granuleSkipEffect", () => {
  it("reports the most-restrictive index's pruning ratio", () => {
    const root = parseAnalyzePlan(MERGETREE_EXAMPLE)!;
    const mt = findMergeTree(root)!;
    const effect = granuleSkipEffect(mt)!;
    // PrimaryKey (3/12) is most restrictive → 75% skipped.
    expect(effect.source).toBe("PrimaryKey");
    expect(effect.read).toBe(3);
    expect(effect.total).toBe(12);
    expect(effect.skippedPct).toBeCloseTo(75, 1);
  });

  it("returns 0% skip when no index pruned", () => {
    const raw = `Query summary:
  Time: 5 ms

ReadFromMergeTree (t)
      Parts: 1 | Granules: 10
      Indexes:
        PrimaryKey
          Condition: true
          Parts: 1/1
          Granules: 10/10
`;
    const root = parseAnalyzePlan(raw)!;
    const mt = findMergeTree(root)!;
    const effect = granuleSkipEffect(mt)!;
    expect(effect.skippedPct).toBe(0);
    expect(effect.read).toBe(10);
    expect(effect.total).toBe(10);
  });

  it("returns null when there is no index data", () => {
    const raw = `Query summary:
  Time: 5 ms

ReadFromMergeTree (t)
      Parts: 1 | Granules: 10
      I/O: rows 0 → 5
`;
    const root = parseAnalyzePlan(raw)!;
    const mt = findMergeTree(root)!;
    expect(granuleSkipEffect(mt)).toBeNull();
  });

  it("picks the lowest ratio across multiple indexes", () => {
    const raw = `Query summary:
  Time: 5 ms

ReadFromMergeTree (t)
      Indexes:
        Min-Max
          Granules: 80/100
        PrimaryKey
          Granules: 10/100
`;
    const root = parseAnalyzePlan(raw)!;
    const mt = findMergeTree(root)!;
    const effect = granuleSkipEffect(mt)!;
    expect(effect.source).toBe("PrimaryKey");
    expect(effect.skippedPct).toBeCloseTo(90, 1);
  });
});
