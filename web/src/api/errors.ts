/**
 * ApiError wraps a structured backend error response.
 *
 * Backend JSON shape (since Phase 2):
 *   { error: string, code: string, hint?: string, retry: boolean }
 *
 * ApiError preserves all four fields, exposes convenience getters
 * (isRetryable, isNotFound, etc.) for branching in UI code, and
 * extends the native Error class so it integrates with `instanceof`
 * checks and existing `try/catch` patterns.
 */

export type ApiErrorCode =
  | "MISSING_PARAM"
  | "INVALID_PARAM"
  | "INVALID_BODY"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CH_UNREACHABLE"
  | "CH_EXCEPTION"
  | "INTERNAL"
  | "NETWORK_ERROR"
  | "ABORTED"
  | "UNKNOWN";

interface ApiErrorBody {
  error?: string;
  code?: ApiErrorCode;
  hint?: string;
  retry?: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly hint: string;
  readonly retry: boolean;

  constructor(message: string, status: number, code: ApiErrorCode, hint = "", retry = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.retry = retry;
  }

  /** True if the operation might succeed on retry (timeouts, throttling, transient CH errors). */
  isRetryable(): boolean {
    return this.retry;
  }

  /** True if the resource was not found on the server. */
  isNotFound(): boolean {
    return this.code === "NOT_FOUND";
  }

  /** True if the ClickHouse backend is unreachable or rejected auth. */
  isConnectionError(): boolean {
    return this.code === "CH_UNREACHABLE";
  }

  /** True if the error came from a ClickHouse server-side exception (syntax, unknown table, etc.). */
  isClickHouseError(): boolean {
    return this.code === "CH_EXCEPTION";
  }

  /** True if the user's client-side action is forbidden (e.g. read-only mode). */
  isForbidden(): boolean {
    return this.code === "FORBIDDEN";
  }

  /** True if the request was aborted (e.g. component unmounted, manual cancel). Not a real error. */
  isAbort(): boolean {
    return this.code === "ABORTED";
  }

  /**
   * Parse an HTTP response (already known to be !ok) into an ApiError.
   * Falls back gracefully if the body is not JSON or is missing fields.
   */
  static async fromResponse(res: Response): Promise<ApiError> {
    let body: ApiErrorBody = {};
    try {
      body = await res.json();
    } catch {
      // Non-JSON body — synthesise a minimal error.
      return new ApiError(
        res.statusText || `HTTP ${res.status}`,
        res.status,
        res.status >= 500 ? "INTERNAL" : "UNKNOWN",
        "",
        res.status >= 500,
      );
    }

    const message = body.error || res.statusText || `HTTP ${res.status}`;
    const code = body.code ?? inferCodeFromStatus(res.status);
    const hint = body.hint ?? defaultHintForCode(code);
    const retry = body.retry ?? defaultRetryForCode(code, res.status);

    return new ApiError(message, res.status, code, hint, retry);
  }

  /**
   * Wrap any thrown value (network failure, fetch abort, etc.) into
   * an ApiError. Pass-through if already an ApiError.
   */
  static wrap(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof Error) {
      // DOMException.AbortError — caller cancelled (component unmount, AbortController, etc.).
      // Not a real error: callers should swallow these.
      if (err.name === "AbortError") {
        return new ApiError("Request aborted", 0, "ABORTED", "", false);
      }
      // Network failure (fetch never reached the server).
      return new ApiError(
        err.message || "Network request failed",
        0,
        "NETWORK_ERROR",
        "Check your network connection and that the analyzer backend is reachable.",
        true,
      );
    }
    return new ApiError(String(err), 0, "UNKNOWN");
  }
}

function inferCodeFromStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400: return "INVALID_BODY";
    case 401:
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 502:
    case 503:
    case 504: return "CH_UNREACHABLE";
    case 500:
    default: return "INTERNAL";
  }
}

function defaultHintForCode(code: ApiErrorCode): string {
  switch (code) {
    case "CH_UNREACHABLE":
      return "Verify the ClickHouse URL and credentials in the connection bar.";
    case "CH_EXCEPTION":
      return "";
    case "FORBIDDEN":
      return "Disable read-only mode in the SQL Editor settings.";
    case "NOT_FOUND":
      return "The resource may have aged out of query_log. Try widening the time range.";
    default:
      return "";
  }
}

function defaultRetryForCode(code: ApiErrorCode, status: number): boolean {
  if (status === 0 || status >= 500) return true;
  return code === "CH_UNREACHABLE";
}
