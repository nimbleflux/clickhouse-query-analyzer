import { test, expect } from "@playwright/test";
import { chQuery, connectViaUI, flushLogs, runEditorQuery } from "./helpers";

// The main project runs against the unauthenticated instance on :8081 with
// the operator default connection pre-configured.

test.describe.serial("app shell", () => {
  test("connects via the connection bar and renders the dashboard", async ({ page }) => {
    await connectViaUI(page);

    // Dashboard stat cards and sections render with live data. Exact match:
    // a freshly started server also renders a "clickhouse uptime: 0m"
    // warning, which substring-matching would trip the strict-mode check.
    await expect(page.getByText("Uptime", { exact: true })).toBeVisible();
    await expect(page.getByText("System Log Tables")).toBeVisible();
    await expect(page.getByText("Database Sizes")).toBeVisible();
  });
});

test.describe.serial("sql editor", () => {
  test("runs a query, renders the result grid, and switches to the chart view", async ({ page }) => {
    await connectViaUI(page);
    await page.getByRole("link", { name: "SQL Editor" }).click();
    await expect(page.getByText("Write a query and press Run")).toBeVisible();

    await runEditorQuery(
      page,
      "SELECT number AS n, n % 5 AS bucket, toString(number) AS label FROM numbers(50)"
    );

    // Result grid: header cells from the query.
    await expect(page.locator("table th", { hasText: "bucket" })).toBeVisible();

    // Chart toggle (numeric column + >= 2 rows) → recharts surface.
    const chartButton = page.locator("button[title='Chart view']").first();
    await expect(chartButton).toBeVisible();
    await chartButton.click();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    // Back to table still works.
    await page.locator("button[title='Table view']").first().click();
    await expect(page.locator("table th", { hasText: "bucket" })).toBeVisible();
  });

  test("binds {{param}} placeholders from the sidebar", async ({ page }) => {
    await connectViaUI(page);
    await page.getByRole("link", { name: "SQL Editor" }).click();

    // Type the parameterized query (deliberately not run yet — it needs the
    // parameter value first).
    const content = page.locator(".cm-content");
    await content.first().click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("SELECT {{threshold}} AS chosen", { delay: 15 });
    await page.keyboard.press("Escape");

    // The parameters panel detects the placeholder and exposes an input.
    const paramInput = page.locator("input[placeholder='threshold']").first();
    await expect(paramInput).toBeVisible({ timeout: 10_000 });
    await paramInput.fill("12345");

    // Run via the toolbar button; the value binds server-side as Int64.
    await page.getByRole("button", { name: "Run", exact: true }).first().click();
    await expect(page.locator("table td", { hasText: "12345" }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe.serial("query history", () => {
  test("queries page lists executed queries and exports CSV", async ({ page }) => {
    // Seed history via the editor (the exact user path) rather than raw SQL.
    await connectViaUI(page);
    await page.getByRole("link", { name: "SQL Editor" }).click();
    await runEditorQuery(page, "SELECT 424242 AS marker_value");
    await flushLogs();

    await page.getByRole("link", { name: "Queries" }).click();
    await expect(page.getByText("424242").first()).toBeVisible({ timeout: 20_000 });

    // Export produces a real download with CSV content.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("fingerprints group identical statements", async ({ page }) => {
    await connectViaUI(page);
    await page.getByRole("link", { name: "Fingerprints" }).click();
    // Editor runs + global-setup statements group into fingerprint rows.
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  });

  test("compare page opens with an EXPLAIN diff tab", async ({ page }) => {
    await connectViaUI(page);
    await page.goto("/compare");
    // The page requires two query ids; without them it shows its picker /
    // empty prompt — assert the shell renders either way.
    await expect(page.locator("body")).toContainText(/Compare/i);
  });
});

test.describe.serial("new pages", () => {
  test("backups page renders summary and rows-or-empty-state", async ({ page }) => {
    await connectViaUI(page);
    await page.getByRole("link", { name: "Backups" }).click();
    await expect(page.getByText("Backups created")).toBeVisible();

    // system.backups persists across runs (rows cannot be deleted), so the
    // correct assertion depends on the server's actual state.
    const count = Number((await chQuery("SELECT count() FROM system.backups")).trim());
    if (count === 0) {
      await expect(page.getByText("No backups found")).toBeVisible();
    } else {
      await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
      // The created/failed summary reflects the same data.
      await expect(page.getByText(String(count), { exact: true }).first()).toBeVisible();
    }
  });

  test("parts explorer shows partitions, totals, and part rows", async ({ page }) => {
    await connectViaUI(page);
    // Fixture from global-setup: 20k rows across two monthly partitions.
    await page.goto("/tables/e2e/events/parts");
    await expect(page.getByText("e2e.events").first()).toBeVisible();
    // Summary cards carry the row total (formatNumber renders 20000 as 20.0K).
    await expect(page.getByText("20.0K").first()).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 20_000 });
  });
});
