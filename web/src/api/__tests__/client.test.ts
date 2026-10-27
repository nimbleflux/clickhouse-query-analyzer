import { describe, it, expect, vi, afterEach } from "vitest";
import { executeQuery, normalizeQueryResult } from "../client";
import type { QueryAdvisor, QueryResult } from "../types";

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

describe("executeQuery stream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Serves `head` as one NDJSON chunk immediately and `tail` (if any) as a
  // second chunk after `tailDelayMs` — mimicking the backend streaming the
  // rows at once and the advisor after its query_log scans finish.
  function streamResponse(head: string, tail?: string, tailDelayMs = 25): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(head));
        if (tail === undefined) {
          controller.close();
        } else {
          setTimeout(() => {
            controller.enqueue(encoder.encode(tail));
            controller.close();
          }, tailDelayMs);
        }
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }

  const startedLine = JSON.stringify({ type: "started", query_id: "q-1" }) + "\n";
  const resultLine = JSON.stringify({
    type: "result",
    query_id: "q-1",
    result: {
      columns: [{ name: "n", type: "UInt64" }],
      rows: [{ n: 1 }],
      row_count: 1,
      total_rows: -1,
      timing_ms: 12,
      query_id: "q-1",
    },
  }) + "\n";

  it("resolves at the result event; the trailing advisor arrives later", async () => {
    const advisorLine = JSON.stringify({
      type: "advisor",
      query_id: "q-1",
      advisor: { tables: [], warnings: ["remote table"], suggestions: ["add_limit"] },
    }) + "\n";
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(startedLine + resultLine, advisorLine)));

    let resolvedAt = 0;
    let startedId = "";
    let advisorAt = 0;
    let advisorSeen: { advisor?: QueryAdvisor; queryId?: string } = {};

    const p = executeQuery(
      "SELECT 1", 10, 0, undefined, false, undefined,
      undefined,
      (queryId) => { startedId = queryId; },
      undefined,
      undefined,
      (advisor, queryId) => {
        advisorAt = Date.now();
        advisorSeen = { advisor, queryId };
      },
    );
    await p.then(() => { resolvedAt = Date.now(); });

    // The result settles while the advisor is still in flight — the whole
    // point of the trailing event.
    expect(resolvedAt).toBeGreaterThan(0);
    expect(advisorAt).toBe(0);
    expect(startedId).toBe("q-1");

    await new Promise((r) => setTimeout(r, 100));
    expect(advisorSeen.queryId).toBe("q-1");
    expect(advisorSeen.advisor?.warnings).toEqual(["remote table"]);
    expect(advisorSeen.advisor?.suggestions).toEqual(["add_limit"]);
  });

  it("still resolves when the stream ends without an advisor event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(startedLine + resultLine)));
    const r = await executeQuery("SELECT 1", 10, 0);
    expect(r.query_id).toBe("q-1");
    expect(r.rows).toHaveLength(1);
  });
});
