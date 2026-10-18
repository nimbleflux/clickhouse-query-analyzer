import { test, expect } from "@playwright/test";

// Runs against the :8082 project — the instance started with
// -auth-token=e2e-secret. Covers the only application-level auth path
// end-to-end: 401 → dialog → token → working app.

test("prompts for the access token and accepts the correct one", async ({ page }) => {
  await page.goto("/");

  // The API 401s surface the Access-token dialog before any data loads.
  const dialog = page.getByText("Access token", { exact: true }).first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  // Wrong token → reload → still unauthorized → dialog again.
  await page.locator("input[type='password'], input[type='text']").last().fill("wrong-token");
  await page.getByRole("button", { name: /save/i }).click();
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  // Correct token → reload → app shell renders without the dialog.
  await page.locator("input[type='password'], input[type='text']").last().fill("e2e-secret");
  await page.getByRole("button", { name: /save/i }).click();
  await page.waitForLoadState("load");
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  // The SPA nav (server default pre-fills the connection form) is present —
  // i.e. /api/config and friends now answer 200.
  await expect(page.locator("nav, aside").first()).toBeVisible();
});

test("health endpoint stays open while the API is gated", async ({ request }) => {
  const health = await request.get("/health");
  expect(health.status()).toBe(200);

  const gated = await request.get("/api/config");
  expect(gated.status()).toBe(401);
  const body = await gated.json();
  expect(body.code).toBe("UNAUTHORIZED");

  const authed = await request.get("/api/config", {
    headers: { "X-Auth-Token": "e2e-secret" },
  });
  expect(authed.status()).toBe(200);
});
