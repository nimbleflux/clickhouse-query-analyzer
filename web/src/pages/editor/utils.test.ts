import { describe, it, expect } from "vitest";
import { splitQueries, stripLeadingComments, escapeCell } from "./utils";

describe("splitQueries", () => {
  it("splits simple statements and trims them", () => {
    expect(splitQueries("SELECT 1; SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps a trailing statement without a semicolon", () => {
    expect(splitQueries("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("does not split on ; inside single-quoted strings", () => {
    expect(splitQueries("SELECT ';'; SELECT 2")).toEqual(["SELECT ';'", "SELECT 2"]);
  });

  it("does not split on ; inside double-quoted identifiers", () => {
    expect(splitQueries('SELECT "a;b" FROM t')).toEqual(['SELECT "a;b" FROM t']);
  });

  it("handles doubled quotes inside strings", () => {
    expect(splitQueries("SELECT 'it''s;a test'")).toEqual(["SELECT 'it''s;a test'"]);
    expect(splitQueries('SELECT "a""b;c"')).toEqual(['SELECT "a""b;c"']);
  });

  it("does not split on ; inside backtick identifiers", () => {
    expect(splitQueries("SELECT `a;b` FROM t")).toEqual(["SELECT `a;b` FROM t"]);
  });

  it("does not split on ; inside -- comments (comment content stripped)", () => {
    // The commented ';' must not create a bogus "still comment" fragment.
    expect(splitQueries("SELECT 1 -- comment; still comment\n; SELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("does not split on ; inside block comments", () => {
    expect(splitQueries("SELECT 1 /* note; still note */; SELECT 2")).toEqual([
      "SELECT 1 /* note; still note */",
      "SELECT 2",
    ]);
  });

  it("handles nested block comments (ClickHouse /* /* */ */)", () => {
    expect(splitQueries("SELECT /* outer; /* inner; */ still outer; */ 1; SELECT 2")).toEqual([
      "SELECT /* outer; /* inner; */ still outer; */ 1",
      "SELECT 2",
    ]);
  });

  it("does not treat comment markers inside strings as comments", () => {
    expect(splitQueries("SELECT '--not a comment;nope'")).toEqual(["SELECT '--not a comment;nope'"]);
  });

  it("does not split on backslash-escaped quotes", () => {
    expect(splitQueries("SELECT 'a\\'b;SELECT'")).toEqual(["SELECT 'a\\'b;SELECT'"]);
    expect(splitQueries('SELECT "a\\"b;SELECT"')).toEqual(['SELECT "a\\"b;SELECT"']);
  });

  it("handles an escaped backslash at the end of a string", () => {
    // 'a\\' — the second backslash is escaped, so the final ' closes the string.
    expect(splitQueries("SELECT 'a\\\\'; SELECT 2")).toEqual(["SELECT 'a\\\\'", "SELECT 2"]);
  });

  it("keeps a FORMAT clause with the statement", () => {
    expect(splitQueries("SELECT 1 FORMAT CSV")).toEqual(["SELECT 1 FORMAT CSV"]);
    expect(splitQueries("SELECT 1 FORMAT CSV; SELECT 2 FORMAT JSON")).toEqual([
      "SELECT 1 FORMAT CSV",
      "SELECT 2 FORMAT JSON",
    ]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(splitQueries("  ;  \n ")).toEqual([]);
  });
});

describe("stripLeadingComments", () => {
  it("returns the statement untouched when no comments lead", () => {
    expect(stripLeadingComments("SELECT 1")).toBe("SELECT 1");
  });

  it("strips a leading -- comment", () => {
    expect(stripLeadingComments("-- why\nSELECT 1")).toBe("SELECT 1");
  });

  it("strips stacked and mixed comments", () => {
    expect(stripLeadingComments("-- one\n/* two */ -- three\nSELECT 1")).toBe("SELECT 1");
  });

  it("strips a leading block comment", () => {
    expect(stripLeadingComments("/* header */ DROP TABLE t")).toBe("DROP TABLE t");
  });

  it("does not strip an inner comment", () => {
    expect(stripLeadingComments("SELECT /* mid */ 1")).toBe("SELECT /* mid */ 1");
  });

  it("fails closed on an unterminated -- comment", () => {
    expect(stripLeadingComments("-- no newline")).toBe("");
  });

  it("fails closed on an unterminated block comment", () => {
    expect(stripLeadingComments("/* never closed SELECT 1")).toBe("");
  });
});

describe("escapeCell", () => {
  it("leaves plain values untouched", () => {
    expect(escapeCell("abc", ",")).toBe("abc");
    expect(escapeCell(123, ",")).toBe("123");
  });

  it("quotes values containing the separator, quotes, or newlines", () => {
    expect(escapeCell("a,b", ",")).toBe('"a,b"');
    expect(escapeCell('a"b', ",")).toBe('"a""b"');
    expect(escapeCell("a\nb", ",")).toBe('"a\nb"');
    expect(escapeCell("a\tb", "\t")).toBe('"a\tb"');
  });

  it("maps null and undefined to empty string", () => {
    expect(escapeCell(null, ",")).toBe("");
    expect(escapeCell(undefined, ",")).toBe("");
  });

  it("prefixes formula-triggering leading characters with a single quote", () => {
    expect(escapeCell("=SUM(A1)", ",")).toBe("'=SUM(A1)");
    expect(escapeCell("+cmd", ",")).toBe("'+cmd");
    expect(escapeCell("-cmd", ",")).toBe("'-cmd");
    expect(escapeCell("@x", ",")).toBe("'@x");
  });

  it("prefixes after quoting when both apply", () => {
    expect(escapeCell("=1,2", ",")).toBe("'\"=1,2\"");
  });

  it("guards header cells the same way", () => {
    expect(escapeCell("=header", ",")).toBe("'=header");
  });
});
