import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    // Default 5010 so we never reuse a stale :5000 process missing dev routes (e2e-flow-setup).
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5010",
    trace: "on-first-retry",
    viewport: { width: 1400, height: 900 },
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "cross-env PORT=5010 npm run dev",
        url: "http://127.0.0.1:5010",
        reuseExistingServer: !!process.env.PLAYWRIGHT_REUSE_SERVER,
        timeout: 180_000,
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
