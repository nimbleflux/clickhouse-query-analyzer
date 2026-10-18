import { describe, it, expect } from "vitest";
import { diffPlans, normalizePlanLine } from "../planDiff";

describe("normalizePlanLine", () => {
  it("trims whitespace and leading tree glyphs", () => {
    expect(normalizePlanLine("  │   └─ ReadFromMergeTree  ")).toBe("ReadFromMergeTree");
    expect(normalizePlanLine("├─ Filter")).toBe("Filter");
    expect(normalizePlanLine("── Expression")).toBe("Expression");
  });

  it("strips bracketed node ids and hex addresses", () => {
    expect(normalizePlanLine("ReadFromMergeTree [123]")).toBe("ReadFromMergeTree");
    expect(normalizePlanLine("Expression [0x7f3a9b]")).toBe("Expression");
  });
});

describe("diffPlans", () => {
  const plan = (parts: number, marks: number) =>
    [
      "EXPLAIN index = 1",
      "Expression (Project names)",
      "  ReadFromMergeTree (default.t)",
      `  Parts: ${parts}`,
      `  Marks: ${marks}/1024`,
    ].join("\n");

  it("marks every row same for identical plans (even with differing ids/indentation)", () => {
    const a = "ReadFromMergeTree [101]\n  Parts: 5";
    const b = "  │ ReadFromMergeTree [999]\nParts: 5";
    const rows = diffPlans(a, b);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.kind === "same")).toBe(true);
  });

  it("marks changed metric values as changed", () => {
    const rows = diffPlans(plan(5, 12), plan(7, 12));
    const changed = rows.filter((r) => r.kind === "changed");
    expect(changed.length).toBe(1);
    expect(changed[0].text).toContain("Parts: 7");
    // Unchanged metric stays same.
    expect(rows.some((r) => r.kind === "same" && r.text.includes("Marks: 12"))).toBe(true);
    expect(rows.some((r) => r.kind === "removed" || r.kind === "added")).toBe(false);
  });

  it("renders reordered lines as removed + added, not a plain same run", () => {
    const a = ["Header", "Alpha", "Beta", "Tail"].join("\n");
    const b = ["Header", "Beta", "Alpha", "Tail"].join("\n");
    const rows = diffPlans(a, b);
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toContain("removed");
    expect(kinds).toContain("added");
    // Header, the moved line (collapsed to same), and Tail are unchanged.
    expect(kinds.filter((k) => k === "same")).toHaveLength(3);
  });

  it("marks lines only in B as added and lines only in A as removed", () => {
    const a = ["Header", "OldStep", "Tail"].join("\n");
    const b = ["Header", "NewStep", "ExtraStep", "Tail"].join("\n");
    const rows = diffPlans(a, b);
    expect(rows.some((r) => r.kind === "removed" && r.text === "OldStep")).toBe(true);
    expect(rows.some((r) => r.kind === "added" && r.text === "NewStep")).toBe(true);
    expect(rows.some((r) => r.kind === "added" && r.text === "ExtraStep")).toBe(true);
    expect(rows.filter((r) => r.kind === "same")).toHaveLength(2);
  });

  it("ignores blank lines and renders original (non-normalized) text for same rows", () => {
    const rows = diffPlans("A\n\nB\n", "\n  A\n\nB");
    expect(rows).toEqual([
      { text: "  A", kind: "same" },
      { text: "B", kind: "same" },
    ]);
  });

  it("handles empty inputs", () => {
    expect(diffPlans("", "")).toEqual([]);
    expect(diffPlans("", "X")).toEqual([{ text: "X", kind: "added" }]);
    expect(diffPlans("X", "")).toEqual([{ text: "X", kind: "removed" }]);
  });
});
