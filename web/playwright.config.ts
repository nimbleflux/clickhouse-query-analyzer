import { defineConfig } from "@playwright/test";

/**
 * E2E suite. Runs the REAL release artifact: the Go binary with the
 * production frontend embedded (build it first — `make e2e` does this), so
 * embedding, CSP headers, and static caching are exactly what ships.
 *
 * Prerequisites (the Makefile target wires these):
 *   - dev ClickHouse up + seeded:  make dev-clickhouse && make seed
 *   - e2e binary built:            go build -o clickhouse-query-analyzer-e2e ./cmd/server
 *     (after `make build-frontend` so the embed is current)
 *
 * Two instances, two projects:
 *   - app  → http://localhost:8081, no auth, operator default connection
 *     pre-configured (the "enter a URL and go" path).
 *   - auth → http://localhost:8082, started with -auth-token=e2e-secret;
 *     exercises the Access-token dialog and header gating.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "app",
      testIgnore: /auth\.spec\.ts/,
      use: { baseURL: "http://localhost:8081" },
    },
    {
      name: "auth",
      testMatch: /auth\.spec\.ts/,
      use: { baseURL: "http://localhost:8082" },
    },
  ],
  webServer: [
    {
      command: "../clickhouse-query-analyzer-e2e -port 8081 -clickhouse-url clickhouse://localhost:19000",
      url: "http://localhost:8081/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "../clickhouse-query-analyzer-e2e -port 8082 -clickhouse-url clickhouse://localhost:19000 -auth-token e2e-secret",
      url: "http://localhost:8082/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
