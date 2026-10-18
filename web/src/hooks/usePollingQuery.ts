import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/errors";
import { useElapsedTimer } from "./useElapsedTimer";

/**
 * Why the fetcher receives a second argument:
 *
 * Most pages fetch exactly the same thing on every tick, but a few (e.g.
 * Replication) deliberately fetch a cheaper payload on live auto-refresh
 * ticks than on the initial/manual load, so a live poll must be
 * distinguishable from a user-initiated load. Callers that don't care simply
 * ignore the second parameter.
 */
export type PollFetchKind = "load" | "live";

export type PollFetcher<T> = (signal: AbortSignal, kind: PollFetchKind) => Promise<T>;

export interface UsePollingQueryOptions {
  /**
   * Extra values that should trigger a fresh load when they change (filters,
   * time windows, …). The fetcher itself should be memoized with useCallback
   * over the state it closes over — pages that do that don't need `deps`.
   */
  deps?: unknown[];
  /** When false (e.g. not yet connected to ClickHouse) nothing is fetched. */
  enabled?: boolean;
  /** Initial value for the auto-refresh toggle. Default false — live polling is opt-in. */
  live?: boolean;
  /** Auto-refresh interval in milliseconds. Default 10s. */
  intervalMs?: number;
}

export interface UsePollingQueryResult<T> {
  data: T | null;
  loading: boolean;
  /** ApiError from the backend, or a DOMException for native fetch failures. Aborts are not surfaced here. */
  error: ApiError | DOMException | null;
  /** True after the user pressed Cancel on the initial load. */
  canceled: boolean;
  /** Whole seconds the current load has been in flight (0 when idle). */
  elapsed: number;
  /** Abort the in-flight request and show the canceled state. */
  cancel: () => void;
  /** Run a fresh (non-live) load. */
  reload: () => void;
  live: boolean;
  setLive: (v: boolean) => void;
}

/**
 * Shared fetch/abort/loading/error/cancel/auto-refresh lifecycle for the
 * read-only monitoring pages. Previously every page hand-rolled ~40 lines of
 * AbortController + "abort is not an error" + elapsed-timer boilerplate.
 *
 * Semantics (preserved from the pages this replaced):
 *  - A new fetch aborts the previous in-flight one; a stale response never
 *    clobbers newer state.
 *  - Cancellation (ApiError.isAbort() / DOMException "AbortError") is treated
 *    as "not an error": no error is set.
 *  - `elapsed` ticks via the shared useElapsedTimer while loading.
 *  - The auto-refresh interval only runs while `live` is on.
 *  - `enabled: false` (pages gated on `connected`) skips fetching entirely.
 */
export function usePollingQuery<T>(
  fetcher: PollFetcher<T>,
  opts: UsePollingQueryOptions = {},
): UsePollingQueryResult<T> {
  const { deps = [], enabled = true, live: initialLive = false, intervalMs = 10_000 } = opts;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | DOMException | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [live, setLive] = useState(initialLive);

  const controllerRef = useRef<AbortController | null>(null);
  // Identifies the newest run; stale runs (aborted because a newer one started,
  // or after unmount) must not touch state.
  const runIdRef = useRef(0);
  const elapsed = useElapsedTimer(loading);

  const run = useCallback(
    async (kind: PollFetchKind) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      const runId = ++runIdRef.current;
      setCanceled(false);
      setLoading(true);
      setError(null);
      try {
        const result = await fetcher(controller.signal, kind);
        if (runIdRef.current !== runId) return;
        setData(result);
      } catch (e) {
        if (runIdRef.current !== runId) return;
        // Abortions (user cancel, deps change, unmount) are not errors.
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.isAbort()) return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof ApiError ? e : ApiError.wrap(e));
      } finally {
        if (runIdRef.current === runId) setLoading(false);
      }
    },
    [fetcher],
  );

  // Initial load + reload whenever the fetcher (i.e. the filters it closes
  // over), the explicit deps, or `enabled` change. Cleanup aborts the
  // in-flight request without marking it canceled.
  useEffect(() => {
    if (!enabled) return;
    void run("load");
    return () => controllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  // Auto-refresh: only while live is on, and re-armed when the fetcher/deps
  // change so ticks always use the current filters.
  useEffect(() => {
    if (!enabled || !live) return;
    const id = setInterval(() => void run("live"), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, live, intervalMs, run, ...deps]);

  const cancel = useCallback(() => {
    setCanceled(true);
    setLoading(false);
    controllerRef.current?.abort();
  }, []);

  const reload = useCallback(() => void run("load"), [run]);

  return { data, loading, error, canceled, elapsed, cancel, reload, live, setLive };
}
