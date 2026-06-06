import { describe, it, expect } from "vitest";
import { encodeSnapshot, decodeSnapshot } from "../lib/snapshot";

describe("snapshot", () => {
  const sample = {
    sql: "SELECT 1",
    parameters: { id: "42" },
    v: 1 as const,
  };

  it("roundtrips a simple snapshot", () => {
    const encoded = encodeSnapshot(sample);
    expect(encoded.startsWith("#s=")).toBe(true);
    const decoded = decodeSnapshot(encoded);
    expect(decoded).toEqual(sample);
  });

  it("roundtrips unicode SQL", () => {
    const s = { sql: "SELECT '日本語 — émoji 🚀'", v: 1 as const };
    const encoded = encodeSnapshot(s);
    const decoded = decodeSnapshot(encoded);
    expect(decoded?.sql).toBe(s.sql);
  });

  it("roundtrips large SQL", () => {
    const big = "SELECT ".repeat(5000);
    const s = { sql: big, v: 1 as const };
    const encoded = encodeSnapshot(s);
    const decoded = decodeSnapshot(encoded);
    expect(decoded?.sql).toBe(big);
  });

  it("returns null for invalid input", () => {
    expect(decodeSnapshot("#s=not-base64-!!!")).toBeNull();
  });

  it("returns null for missing version", () => {
    const raw = btoa(JSON.stringify({ sql: "SELECT 1" }));
    expect(decodeSnapshot(`#s=${raw}`)).toBeNull();
  });

  it("returns null for empty hash", () => {
    expect(decodeSnapshot("")).toBeNull();
    expect(decodeSnapshot("#")).toBeNull();
  });

  it("returns null when prefix doesn't match", () => {
    expect(decodeSnapshot("#x=abc")).toBeNull();
  });
});
