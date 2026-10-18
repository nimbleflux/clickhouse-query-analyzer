import { describe, it, expect } from "vitest";
import { diffColorClass } from "../QueryCompare";

// diffColorClass drives the diff coloring on the Compare page. Semantics must
// match the metric, not the sign: for output-size metrics (Result Rows /
// Written Rows / Written Bytes) a bigger B is not a regression.
describe("diffColorClass", () => {
  it("returns neutral for a zero diff", () => {
    expect(diffColorClass(0, true)).toBe("");
    expect(diffColorClass(0, false)).toBe("");
  });

  it("colors a positive diff red when higher is worse", () => {
    expect(diffColorClass(100, true)).toBe("text-[var(--color-error)]");
  });

  it("colors a negative diff green when higher is worse", () => {
    expect(diffColorClass(-100, true)).toBe("text-[var(--color-success)]");
  });

  it("flips polarity when higher is not worse (output-size metrics)", () => {
    expect(diffColorClass(100, false)).toBe("text-[var(--color-success)]");
    expect(diffColorClass(-100, false)).toBe("text-[var(--color-error)]");
  });
});
