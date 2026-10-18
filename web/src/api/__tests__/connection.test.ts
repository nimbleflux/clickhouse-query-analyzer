import { describe, it, expect, beforeEach, vi } from "vitest";

class StorageMock {
  private store: Record<string, string> = {};
  getItem(key: string) { return this.store[key] ?? null; }
  setItem(key: string, value: string) { this.store[key] = value; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
  get length() { return Object.keys(this.store).length; }
  key(_index: number) { return Object.keys(this.store)[_index] ?? null; }
}

const connectionModule = () => import("../connection");
const schemaCacheModule = () => import("../schema-cache");

const PARAMS = {
  url: "https://ch.example.com:8443",
  user: "analyst",
  password: "s3cret",
  database: "logs",
  skip_tls: true,
  readonly: true,
};

describe("connection", () => {
  let local: StorageMock;
  let session: StorageMock;

  beforeEach(() => {
    local = new StorageMock();
    session = new StorageMock();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
  });

  describe("saveConnection", () => {
    it("persists everything except the password to localStorage", async () => {
      const { saveConnection } = await connectionModule();
      saveConnection(PARAMS);
      const stored = JSON.parse(local.getItem("ch-query-analyzer-connection")!);
      expect(stored).toEqual({
        url: PARAMS.url,
        user: PARAMS.user,
        database: PARAMS.database,
        skip_tls: true,
        readonly: true,
      });
      expect("password" in stored).toBe(false);
    });

    it("keeps the password in sessionStorage only", async () => {
      const { saveConnection } = await connectionModule();
      saveConnection(PARAMS);
      expect(session.getItem("ch-query-analyzer-password")).toBe("s3cret");
    });
  });

  describe("loadConnection", () => {
    it("returns defaults when nothing is saved", async () => {
      const { loadConnection } = await connectionModule();
      expect(loadConnection()).toEqual({
        url: "clickhouse://localhost:9000",
        user: "default",
        password: "",
        database: "system",
        skip_tls: false,
        readonly: false,
      });
    });

    it("merges the localStorage base with the sessionStorage password", async () => {
      const { saveConnection, loadConnection } = await connectionModule();
      saveConnection(PARAMS);
      const loaded = loadConnection();
      expect(loaded.url).toBe(PARAMS.url);
      expect(loaded.user).toBe(PARAMS.user);
      expect(loaded.password).toBe("s3cret");
    });

    it("drops a password field persisted by older versions", async () => {
      local.setItem(
        "ch-query-analyzer-connection",
        JSON.stringify({ url: "https://old.example.com", user: "u", password: "stale", database: "d", skip_tls: false, readonly: false }),
      );
      const { loadConnection } = await connectionModule();
      expect(loadConnection().password).toBe("");
    });
  });

  describe("setConnectionHeaders", () => {
    it("exposes the connection as request headers, password included", async () => {
      const { setConnectionHeaders, getConnectionHeaders } = await connectionModule();
      setConnectionHeaders(PARAMS);
      expect(getConnectionHeaders()).toEqual({
        "X-CH-URL": PARAMS.url,
        "X-CH-User": PARAMS.user,
        "X-CH-Password": "s3cret",
        "X-CH-Database": PARAMS.database,
        "X-CH-Skip-TLS": "1",
      });
    });

    it("invalidates the schema cache so the sidebar refetches", async () => {
      const { setConnectionHeaders } = await connectionModule();
      const { setCachedDatabases, setCachedSchemaData, getCachedDatabases, getCachedSchemaData } = await schemaCacheModule();
      setCachedDatabases(["default", "system"]);
      setCachedSchemaData({ system: { tables: [] } });
      setConnectionHeaders(PARAMS);
      expect(getCachedDatabases()).toEqual([]);
      expect(getCachedSchemaData()).toEqual({});
    });
  });

  describe("clearConnectionHeaders", () => {
    it("clears the headers and the sessionStorage password", async () => {
      const { setConnectionHeaders, clearConnectionHeaders, getConnectionHeaders } = await connectionModule();
      setConnectionHeaders(PARAMS);
      expect(session.getItem("ch-query-analyzer-password")).toBe("s3cret");
      clearConnectionHeaders();
      expect(getConnectionHeaders()).toEqual({});
      expect(session.getItem("ch-query-analyzer-password")).toBeNull();
    });
  });
});
