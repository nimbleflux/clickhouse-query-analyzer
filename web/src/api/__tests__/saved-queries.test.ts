import { describe, it, expect, beforeEach, vi } from "vitest";

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string) { return this.store[key] ?? null; }
  setItem(key: string, value: string) { this.store[key] = value; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
  get length() { return Object.keys(this.store).length; }
  key(_index: number) { return Object.keys(this.store)[_index] ?? null; }
}

const savedQueriesModule = () => import("../saved-queries");

describe("saved-queries", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new LocalStorageMock());
  });

  describe("loadSavedQueries", () => {
    it("returns empty array when nothing stored", async () => {
      const { loadSavedQueries } = await savedQueriesModule();
      expect(loadSavedQueries()).toEqual([]);
    });

    it("returns parsed queries from localStorage", async () => {
      const queries = [{ id: "abc", name: "Test", sql: "SELECT 1", createdAt: 1000, updatedAt: 1000 }];
      localStorage.setItem("ch-saved-queries", JSON.stringify(queries));
      const { loadSavedQueries } = await savedQueriesModule();
      expect(loadSavedQueries()).toEqual(queries);
    });

    it("returns empty array for invalid JSON", async () => {
      localStorage.setItem("ch-saved-queries", "not json");
      const { loadSavedQueries } = await savedQueriesModule();
      expect(loadSavedQueries()).toEqual([]);
    });

    it("returns empty array for non-array JSON", async () => {
      localStorage.setItem("ch-saved-queries", JSON.stringify({ foo: "bar" }));
      const { loadSavedQueries } = await savedQueriesModule();
      expect(loadSavedQueries()).toEqual([]);
    });
  });

  describe("addSavedQuery", () => {
    it("adds a query and returns it", async () => {
      const { addSavedQuery, loadSavedQueries } = await savedQueriesModule();
      const q = addSavedQuery("My Query", "SELECT 1");
      expect(q.name).toBe("My Query");
      expect(q.sql).toBe("SELECT 1");
      expect(q.params).toEqual({});
      expect(q.id).toBeTruthy();
      expect(q.createdAt).toBeGreaterThan(0);

      const stored = loadSavedQueries();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(q.id);
    });

    it("stores params when provided", async () => {
      const { addSavedQuery, loadSavedQueries } = await savedQueriesModule();
      const q = addSavedQuery("Param Query", "SELECT * FROM {{table}}", { table: "users" });
      expect(q.params).toEqual({ table: "users" });
      const stored = loadSavedQueries();
      expect(stored[0].params).toEqual({ table: "users" });
    });

    it("prepends new queries", async () => {
      const { addSavedQuery, loadSavedQueries } = await savedQueriesModule();
      addSavedQuery("First", "SELECT 1");
      addSavedQuery("Second", "SELECT 2");
      const stored = loadSavedQueries();
      expect(stored).toHaveLength(2);
      expect(stored[0].name).toBe("Second");
      expect(stored[1].name).toBe("First");
    });
  });

  describe("updateSavedQuery", () => {
    it("updates name and sql", async () => {
      const { addSavedQuery, updateSavedQuery } = await savedQueriesModule();
      const q = addSavedQuery("Original", "SELECT 1");
      const updated = updateSavedQuery(q.id, { name: "Updated", sql: "SELECT 2" });
      expect(updated?.name).toBe("Updated");
      expect(updated?.sql).toBe("SELECT 2");
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(q.createdAt);
    });

    it("returns null for non-existent id", async () => {
      const { updateSavedQuery } = await savedQueriesModule();
      expect(updateSavedQuery("nonexistent", { name: "X" })).toBeNull();
    });
  });

  describe("deleteSavedQuery", () => {
    it("deletes a query by id", async () => {
      const { addSavedQuery, deleteSavedQuery, loadSavedQueries } = await savedQueriesModule();
      const q1 = addSavedQuery("Q1", "SELECT 1");
      const q2 = addSavedQuery("Q2", "SELECT 2");
      expect(deleteSavedQuery(q1.id)).toBe(true);
      const stored = loadSavedQueries();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(q2.id);
    });

    it("returns false for non-existent id", async () => {
      const { deleteSavedQuery } = await savedQueriesModule();
      expect(deleteSavedQuery("nonexistent")).toBe(false);
    });
  });

  describe("importSavedQueries", () => {
    it("adds new queries skipping duplicates by name", async () => {
      const { addSavedQuery, importSavedQueries, loadSavedQueries } = await savedQueriesModule();
      addSavedQuery("Existing", "SELECT 1");
      const result = importSavedQueries([
        { id: "x", name: "Existing", sql: "SELECT 1", params: {}, createdAt: 1000, updatedAt: 1000 },
        { id: "y", name: "New Query", sql: "SELECT 2", params: {}, createdAt: 2000, updatedAt: 2000 },
      ]);
      expect(result.added).toBe(1);
      expect(result.skipped).toBe(1);
      const stored = loadSavedQueries();
      expect(stored).toHaveLength(2);
    });

    it("imports all queries when no duplicates", async () => {
      const { importSavedQueries, loadSavedQueries } = await savedQueriesModule();
      const result = importSavedQueries([
        { id: "a", name: "Q1", sql: "SELECT 1", params: {}, createdAt: 1000, updatedAt: 1000 },
        { id: "b", name: "Q2", sql: "SELECT 2", params: {}, createdAt: 2000, updatedAt: 2000 },
      ]);
      expect(result.added).toBe(2);
      expect(result.skipped).toBe(0);
      expect(loadSavedQueries()).toHaveLength(2);
    });

    it("handles empty import array", async () => {
      const { importSavedQueries } = await savedQueriesModule();
      const result = importSavedQueries([]);
      expect(result.added).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("preserves params on import", async () => {
      const { importSavedQueries, loadSavedQueries } = await savedQueriesModule();
      importSavedQueries([
        { id: "a", name: "Q1", sql: "SELECT * FROM {{table}}", params: { table: "users" }, createdAt: 1000, updatedAt: 1000 },
      ]);
      const stored = loadSavedQueries();
      expect(stored[0].params).toEqual({ table: "users" });
    });
  });

  describe("detectParams", () => {
    it("detects no params in plain SQL", async () => {
      const { detectParams } = await savedQueriesModule();
      expect(detectParams("SELECT * FROM table")).toEqual([]);
    });

    it("detects single parameter", async () => {
      const { detectParams } = await savedQueriesModule();
      expect(detectParams("SELECT * FROM table WHERE id = {{id}}")).toEqual(["id"]);
    });

    it("detects multiple parameters", async () => {
      const { detectParams } = await savedQueriesModule();
      const params = detectParams("SELECT * FROM {{table}} WHERE id = {{id}} AND date > {{start_date}}");
      expect(params.sort()).toEqual(["id", "start_date", "table"]);
    });

    it("deduplicates parameters", async () => {
      const { detectParams } = await savedQueriesModule();
      expect(detectParams("{{id}} + {{id}}")).toEqual(["id"]);
    });

    it("does not detect escaped parameters", async () => {
      const { detectParams } = await savedQueriesModule();
      expect(detectParams("SELECT '\\{{id}}' FROM table")).toEqual([]);
    });

    it("only matches word characters in param names", async () => {
      const { detectParams } = await savedQueriesModule();
      const params = detectParams("{{foo_bar}} {{baz123}}");
      expect(params.sort()).toEqual(["baz123", "foo_bar"]);
    });

    it("handles empty string", async () => {
      const { detectParams } = await savedQueriesModule();
      expect(detectParams("")).toEqual([]);
    });
  });

  describe("resolveParams", () => {
    it("replaces parameters with values", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(resolveParams("SELECT {{col}} FROM {{tbl}}", { col: "name", tbl: "users" }))
        .toBe("SELECT name FROM users");
    });

    it("leaves unreplaced params as-is", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(resolveParams("SELECT {{col}} FROM {{tbl}}", { col: "name" }))
        .toBe("SELECT name FROM {{tbl}}");
    });

    it("handles empty params", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(resolveParams("SELECT 1", {})).toBe("SELECT 1");
    });

    it("handles empty string values", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(resolveParams("WHERE x = {{val}}", { val: "" })).toBe("WHERE x = ");
    });

    it("resolves escaped braces to literal braces", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(resolveParams("SELECT \\{{not_a_param}}", {})).toBe("SELECT {{not_a_param}}");
    });

    it("resolves params and escapes simultaneously", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(
        resolveParams("SELECT {{col}}, \\{{literal}} FROM {{tbl}}", { col: "id", tbl: "users" })
      ).toBe("SELECT id, {{literal}} FROM users");
    });

    it("handles multiple occurrences of same param", async () => {
      const { resolveParams } = await savedQueriesModule();
      expect(resolveParams("{{x}} + {{x}}", { x: "1" })).toBe("1 + 1");
    });
  });

  describe("Param Sets", () => {
    describe("loadParamSets", () => {
      it("returns empty array when nothing stored", async () => {
        const { loadParamSets } = await savedQueriesModule();
        expect(loadParamSets()).toEqual([]);
      });
    });

    describe("addParamSet", () => {
      it("adds a param set and returns it", async () => {
        const { addParamSet, loadParamSets } = await savedQueriesModule();
        const ps = addParamSet("Prod", { table: "users", limit: "100" });
        expect(ps.name).toBe("Prod");
        expect(ps.params).toEqual({ table: "users", limit: "100" });
        expect(ps.id).toBeTruthy();
        expect(loadParamSets()).toHaveLength(1);
      });
    });

    describe("updateParamSet", () => {
      it("updates name and params", async () => {
        const { addParamSet, updateParamSet } = await savedQueriesModule();
        const ps = addParamSet("Old", { a: "1" });
        const updated = updateParamSet(ps.id, { name: "New", params: { a: "2", b: "3" } });
        expect(updated?.name).toBe("New");
        expect(updated?.params).toEqual({ a: "2", b: "3" });
      });

      it("returns null for non-existent id", async () => {
        const { updateParamSet } = await savedQueriesModule();
        expect(updateParamSet("nonexistent", { name: "X" })).toBeNull();
      });
    });

    describe("deleteParamSet", () => {
      it("deletes a param set by id", async () => {
        const { addParamSet, deleteParamSet, loadParamSets } = await savedQueriesModule();
        const ps1 = addParamSet("S1", { x: "1" });
        addParamSet("S2", { y: "2" });
        expect(deleteParamSet(ps1.id)).toBe(true);
        expect(loadParamSets()).toHaveLength(1);
      });

      it("returns false for non-existent id", async () => {
        const { deleteParamSet } = await savedQueriesModule();
        expect(deleteParamSet("nonexistent")).toBe(false);
      });
    });

    describe("importParamSets", () => {
      it("imports new sets and skips duplicates by name", async () => {
        const { addParamSet, importParamSets, loadParamSets } = await savedQueriesModule();
        addParamSet("Existing", { a: "1" });
        const result = importParamSets([
          { id: "x", name: "Existing", params: { a: "2" }, createdAt: 1000, updatedAt: 1000 },
          { id: "y", name: "New Set", params: { b: "3" }, createdAt: 2000, updatedAt: 2000 },
        ]);
        expect(result.added).toBe(1);
        expect(result.skipped).toBe(1);
        expect(loadParamSets()).toHaveLength(2);
      });

      it("preserves params on import", async () => {
        const { importParamSets, loadParamSets } = await savedQueriesModule();
        importParamSets([
          { id: "a", name: "S1", params: { table: "orders", limit: "50" }, createdAt: 1000, updatedAt: 1000 },
        ]);
        expect(loadParamSets()[0].params).toEqual({ table: "orders", limit: "50" });
      });
    });
  });
});
