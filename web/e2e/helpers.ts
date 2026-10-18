import { expect, type Page } from "@playwright/test";

const CH_HTTP = "http://localhost:18123";

/**
 * Run a statement against the dev ClickHouse over HTTP (setup/flush helper,
 * NOT part of what's under test).
 */
export async function chQuery(query: string): Promise<string> {
  const res = await fetch(CH_HTTP + "/", { method: "POST", body: query });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed (${res.status}): ${query}\n${await res.text()}`);
  }
  return res.text();
}

/**
 * system.query_log buffers rows (~7.5s default flush interval). Every test
 * that asserts on query history flushes first, or it races the buffer.
 */
export async function flushLogs(): Promise<void> {
  await chQuery("SYSTEM FLUSH LOGS");
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Connect through the connection bar (bottom-left). On a cold browser
 * profile the server's default connection pre-fills the form but does NOT
 * auto-connect (no server-side password configured), so this clicks through
 * the real user path.
 */
export async function connectViaUI(page: Page): Promise<void> {
  await page.goto("/");
  // Two "Connect" buttons exist: the sidebar rail's (which only expands the
  // form) and the form's submit. Click the submit — the last in DOM order.
  const connectButton = page.getByRole("button", { name: "Connect", exact: true }).last();
  await expect(connectButton).toBeVisible({ timeout: 20_000 });
  await connectButton.click();
  // Collapsed bar shows user@host; dashboard heading confirms data loaded.
  await expect(page.getByText("System Dashboard")).toBeVisible({ timeout: 30_000 });
}

/**
 * Type SQL into the CodeMirror editor and run it, then wait for the result
 * grid (or error surface) to render.
 */
export async function runEditorQuery(page: Page, sql: string): Promise<void> {
  const content = page.locator(".cm-content");
  await content.first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(sql, { delay: 15 });
  // Dismiss any CodeMirror autocomplete popup opened while typing (e.g. on
  // '{') before re-selecting and executing.
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Enter");
  // Either a result table (th cells) or the error surface appears.
  await expect
    .poll(
      async () => {
        const hasResult = await page.locator("table th").count();
        const hasError = await page.locator("text=/SQL Error|Exception|error/i").count();
        return hasResult > 0 || hasError > 0;
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBe(true);
}
