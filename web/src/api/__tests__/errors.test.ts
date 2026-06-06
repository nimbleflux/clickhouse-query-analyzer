import { describe, it, expect } from "vitest";
import { ApiError } from "../errors";

describe("ApiError", () => {
  describe("constructor", () => {
    it("preserves all fields and inherits from Error", () => {
      const err = new ApiError("bad", 400, "INVALID_PARAM", "hint", false);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toBe("bad");
      expect(err.status).toBe(400);
      expect(err.code).toBe("INVALID_PARAM");
      expect(err.hint).toBe("hint");
      expect(err.retry).toBe(false);
      expect(err.name).toBe("ApiError");
    });
  });

  describe("predicate methods", () => {
    it("isRetryable / isNotFound / isConnectionError / isClickHouseError / isForbidden", () => {
      const notFound = new ApiError("x", 404, "NOT_FOUND", "", false);
      expect(notFound.isNotFound()).toBe(true);
      expect(notFound.isRetryable()).toBe(false);

      const unreachable = new ApiError("x", 502, "CH_UNREACHABLE", "", true);
      expect(unreachable.isConnectionError()).toBe(true);
      expect(unreachable.isRetryable()).toBe(true);

      const chExc = new ApiError("syntax", 400, "CH_EXCEPTION", "", false);
      expect(chExc.isClickHouseError()).toBe(true);

      const forbidden = new ApiError("readonly", 403, "FORBIDDEN", "", false);
      expect(forbidden.isForbidden()).toBe(true);
    });
  });

  describe("fromResponse", () => {
    it("parses a structured body", async () => {
      const res = new Response(
        JSON.stringify({ error: "query_id is required", code: "MISSING_PARAM", hint: "provide ?query_id=", retry: false }),
        { status: 400, statusText: "Bad Request" },
      );
      const err = await ApiError.fromResponse(res);
      expect(err.message).toBe("query_id is required");
      expect(err.code).toBe("MISSING_PARAM");
      expect(err.hint).toBe("provide ?query_id=");
      expect(err.retry).toBe(false);
      expect(err.status).toBe(400);
    });

    it("falls back when body is not JSON", async () => {
      const res = new Response("plain text", { status: 500, statusText: "Internal Server Error" });
      const err = await ApiError.fromResponse(res);
      expect(err.message).toBe("Internal Server Error");
      expect(err.code).toBe("INTERNAL");
      expect(err.retry).toBe(true);
    });

    it("falls back when body has only `error` field", async () => {
      const res = new Response(JSON.stringify({ error: "old-style" }), { status: 500 });
      const err = await ApiError.fromResponse(res);
      expect(err.message).toBe("old-style");
      expect(err.code).toBe("INTERNAL");
    });

    it("infers retry=true for 5xx", async () => {
      const res = new Response(JSON.stringify({ error: "boom" }), { status: 502 });
      const err = await ApiError.fromResponse(res);
      expect(err.retry).toBe(true);
    });

    it("infers NOT_FOUND for 404 without code", async () => {
      const res = new Response(JSON.stringify({ error: "nope" }), { status: 404 });
      const err = await ApiError.fromResponse(res);
      expect(err.code).toBe("NOT_FOUND");
    });
  });

  describe("wrap", () => {
    it("passes through existing ApiError", () => {
      const original = new ApiError("x", 400, "INVALID_BODY");
      expect(ApiError.wrap(original)).toBe(original);
    });

    it("wraps native Error as NETWORK_ERROR", () => {
      const wrapped = ApiError.wrap(new Error("fetch failed"));
      expect(wrapped).toBeInstanceOf(ApiError);
      expect(wrapped.code).toBe("NETWORK_ERROR");
      expect(wrapped.retry).toBe(true);
    });

    it("handles AbortError specially", () => {
      const abort = new DOMException("aborted", "AbortError");
      const wrapped = ApiError.wrap(abort);
      expect(wrapped.code).toBe("ABORTED");
      expect(wrapped.retry).toBe(false);
      expect(wrapped.isAbort()).toBe(true);
    });

    it("handles non-Error throws", () => {
      const wrapped = ApiError.wrap("oops");
      expect(wrapped.message).toBe("oops");
      expect(wrapped.code).toBe("UNKNOWN");
    });
  });
});
