import type { NavigateFunction } from "react-router-dom";

/**
 * Navigate to /editor with the given SQL pre-loaded. The Editor listens for
 * `location.state.loadSql` on mount and opens it in a new tab (or replaces
 * the active tab, depending on user preference).
 *
 * This is the shared "send to editor" mechanism used by Query Detail,
 * Fingerprint Detail, Running Queries, Table Optimizer, etc.
 *
 * Server state is not involved — the SQL travels via React Router location
 * state, which is ephemeral and does not appear in the URL.
 */
export function sendToEditor(
  navigate: NavigateFunction,
  sql: string,
  opts: { origin?: string } = {}
): void {
  navigate("/editor", {
    state: {
      loadSql: sql,
      origin: opts.origin,
    },
  });
}
