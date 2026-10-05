import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./tests/database";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./tests/database.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "tablet", use: { ...devices["iPad Pro 11 landscape"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "pnpm start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: "sift-local-e2e-secret-do-not-use-in-production-42",
      BETTER_AUTH_URL: "http://localhost:3100",
    },
  },
});
