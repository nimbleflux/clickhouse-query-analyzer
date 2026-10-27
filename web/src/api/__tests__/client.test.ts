import { describe, it, expect } from "vitest";
import { normalizeQueryResult } from "../client";
import type { QueryResult } from "../types";

describe("normalizeQueryResult", () => {
  it("replaces null rows/columns (Go marshals empty slices as null) with empty arrays", () => {
    // A 0-row result over the HTTP protocol used to ship "rows": null, which
    // crashed the result table on .length.
    const r = normalizeQueryResult({
      columns: null as unknown as QueryResult["columns"],
      rows: null as unknown as QueryResult["rows"],
      row_count: 0,
      total_rows: -1,
      timing_ms: 12,
      query_id: "q1",
    });
    expect(r.columns).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it("normalizes null advisor arrays while keeping a populated advisor", () => {
    const r = normalizeQueryResult({
      columns: [{ name: "n", type: "UInt64" }],
      rows: [{ n: 1 }],
      row_count: 1,
      total_rows: -1,
      timing_ms: 5,
      query_id: "q2",
      advisor: {
        tables: [],
        warnings: null as unknown as string[],
        suggestions: null as unknown as string[],
      },
    });
    expect(r.advisor?.warnings).toEqual([]);
    expect(r.advisor?.suggestions).toEqual([]);
    expect(r.rows).toHaveLength(1);
  });

  it("passes a clean result through unchanged (advisor stays absent)", () => {
    const clean: QueryResult = {
      columns: [{ name: "n", type: "UInt64" }],
      rows: [{ n: 1 }],
      row_count: 1,
      total_rows: 1,
      timing_ms: 5,
      query_id: "q3",
    };
    expect(normalizeQueryResult(clean)).toEqual(clean);
  });
});
