import { describe, it, expect } from "vitest";
import { lastKeyword, resolveFromTables, columnsOfResolved, makeSqlCompletion, type SqlNs } from "./sqlComplete";

const ns: SqlNs = {
  mydb: { users: ["id", "name", "email"], orders: ["id", "user_id", "total"] },
  other: { events: ["event", "ts"] },
};

describe("lastKeyword", () => {
  it("detects column-position keywords", () => {
    expect(lastKeyword("select id from t where ")).toBe("WHERE");
    expect(lastKeyword("select * from t order by ")).toBe("BY");
    expect(lastKeyword("select * from t group by ")).toBe("BY");
    expect(lastKeyword("select ")).toBe("SELECT");
  });

  it("detects table-position keywords", () => {
    expect(lastKeyword("select * from ")).toBe("FROM");
    expect(lastKeyword("select * from t join ")).toBe("JOIN");
  });

  it("returns empty when no keyword is present", () => {
    expect(lastKeyword("")).toBe("");
    expect(lastKeyword("hello world")).toBe("");
  });
});

describe("resolveFromTables", () => {
  it("resolves a qualified db.table reference", () => {
    expect(resolveFromTables("select * from mydb.users", ns)).toEqual([{ db: "mydb", table: "users" }]);
  });

  it("resolves a bare table when its database is unambiguous", () => {
    expect(resolveFromTables("select * from users", ns)).toEqual([{ db: "mydb", table: "users" }]);
  });

  it("leaves db empty when a bare table is ambiguous/unknown", () => {
    expect(resolveFromTables("select * from nowhere_table", ns)).toEqual([{ db: "", table: "nowhere_table" }]);
  });

  it("picks up multiple FROM/JOIN references", () => {
    expect(resolveFromTables("select * from mydb.users u join mydb.orders o on u.id = o.user_id", ns))
      .toEqual([{ db: "mydb", table: "users" }, { db: "mydb", table: "orders" }]);
  });
});

describe("columnsOfResolved", () => {
  it("returns columns of a qualified reference", () => {
    expect(columnsOfResolved(ns, { db: "mydb", table: "users" })).toEqual(["id", "name", "email"]);
  });
  it("resolves columns of an unqualified-but-unique table", () => {
    expect(columnsOfResolved(ns, { db: "", table: "events" })).toEqual(["event", "ts"]);
  });
  it("returns empty for an unknown table", () => {
    expect(columnsOfResolved(ns, { db: "mydb", table: "nope" })).toEqual([]);
  });
});

describe("makeSqlCompletion", () => {
  const source = makeSqlCompletion(() => ns);
  // Minimal CompletionContext stand-in: CodeMirror's real ctx has state.doc and pos.
  const ctxAt = (doc: string, pos = doc.length) => source({ state: { doc: { toString: () => doc } }, pos } as never);

  it("offers columns after ORDER BY using the statement's FROM table", () => {
    const res = ctxAt("select * from mydb.users order by ");
    expect(res).not.toBeNull();
    const labels = (res!.options as { label: string }[]).map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "name", "email"]));
  });

  it("offers columns in the SELECT list when FROM is present later in the text", () => {
    const res = ctxAt("select  from mydb.users", "select ".length);
    expect(res).not.toBeNull();
    const labels = (res!.options as { label: string }[]).map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "name", "email"]));
  });

  it("offers tables after FROM", () => {
    const res = ctxAt("select * from ");
    expect(res).not.toBeNull();
    const labels = (res!.options as { label: string }[]).map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["users", "orders", "mydb"]));
  });

  it("offers columns after a db.table. qualifier", () => {
    const res = ctxAt("select mydb.users.");
    expect(res).not.toBeNull();
    const labels = (res!.options as { label: string }[]).map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "name", "email"]));
  });

  it("returns null inside a string literal", () => {
    expect(ctxAt("select 'abc")).toBeNull();
  });
});
