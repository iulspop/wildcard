import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:8787",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "pnpm db:migrate:local && pnpm exec wrangler dev --local --port 8787 --var TEMPORARY_ROOM_TTL_MS:200 --var SESSION_SECRET:test-session-secret-at-least-32-characters",
    url: "http://localhost:8787",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
