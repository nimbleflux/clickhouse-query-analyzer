import { describe, it, expect } from "vitest";
import { isNumericType, isTemporalType, toNumber, buildChartPoints, defaultXColumn } from "../chartData";

describe("isNumericType", () => {
  it("detects ClickHouse numeric types including wrappers", () => {
    expect(isNumericType("UInt64")).toBe(true);
    expect(isNumericType("Int32")).toBe(true);
    expect(isNumericType("Float64")).toBe(true);
    expect(isNumericType("Decimal(18, 2)")).toBe(true);
    expect(isNumericType("Nullable(UInt32)")).toBe(true);
    expect(isNumericType("LowCardinality(Nullable(Float64))")).toBe(true);
  });

  it("rejects non-numeric types (including numeric inside containers)", () => {
    expect(isNumericType("String")).toBe(false);
    expect(isNumericType("DateTime")).toBe(false);
    expect(isNumericType("Date")).toBe(false);
    expect(isNumericType("Array(UInt8)")).toBe(false);
    expect(isNumericType("Map(String, UInt64)")).toBe(false);
  });
});

describe("isTemporalType", () => {
  it("detects date/datetime including DateTime64 and wrappers", () => {
    expect(isTemporalType("Date")).toBe(true);
    expect(isTemporalType("DateTime")).toBe(true);
    expect(isTemporalType("DateTime64(3)")).toBe(true);
    expect(isTemporalType("Nullable(DateTime)")).toBe(true);
    expect(isTemporalType("String")).toBe(false);
    expect(isTemporalType("UInt64")).toBe(false);
  });
});

describe("toNumber", () => {
  it("coerces values and skips null/NaN", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
    expect(toNumber("abc")).toBeUndefined();
    expect(toNumber("")).toBeUndefined();
  });
});

describe("buildChartPoints", () => {
  const rows = [
    { day: "2026-01-01", n: "10", m: null },
    { day: "2026-01-02", n: 20, m: 4 },
    { day: "2026-01-03", n: "bad", m: 6 },
  ];

  it("coerces Y values, skipping nulls/NaN as gaps", () => {
    const { points, truncated } = buildChartPoints(rows, "day", ["n", "m"]);
    expect(truncated).toBe(false);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: "2026-01-01", label: "2026-01-01", values: { n: 10, m: undefined } });
    expect(points[1].values.n).toBe(20);
    expect(points[2].values.n).toBeUndefined();
    expect(points[2].values.m).toBe(6);
  });

  it("falls back to row index when no X column", () => {
    const { points } = buildChartPoints([{ a: 1 }, { a: 2 }], "", ["a"]);
    expect(points.map((p) => p.x)).toEqual([1, 2]);
    expect(points.map((p) => p.label)).toEqual(["1", "2"]);
  });

  it("caps at 1000 rows and reports truncation", () => {
    const big = Array.from({ length: 1200 }, (_, i) => ({ i, v: i * 2 }));
    const { points, truncated } = buildChartPoints(big, "i", ["v"]);
    expect(points).toHaveLength(1000);
    expect(truncated).toBe(true);
  });
});

describe("defaultXColumn", () => {
  it("prefers temporal, then non-numeric, then row index", () => {
    const cols = [
      { name: "id", type: "UInt64" },
      { name: "day", type: "Date" },
      { name: "label", type: "String" },
      { name: "v", type: "Float64" },
    ];
    expect(defaultXColumn(cols)).toBe("day");
    expect(defaultXColumn([
      { name: "label", type: "String" },
      { name: "v", type: "Float64" },
    ])).toBe("label");
    expect(defaultXColumn([
      { name: "v", type: "Float64" },
      { name: "n", type: "UInt32" },
    ])).toBe("");
  });
});
